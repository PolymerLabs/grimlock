/**
 * @license
 * Copyright (c) 2019 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import ts from 'typescript';
import {isAssignableToType, SimpleType, SimpleTypeKind} from 'ts-simple-type';
import * as path from 'path';
import * as ast from './soy-ast.js';
import * as parse5 from 'parse5';
import {traverseHtml} from './utils.js';
import {getReflectedAttributeName} from './reflected-attribute-name.js'

const isTextNode = (
  node: parse5.AST.Default.Node
): node is parse5.AST.Default.TextNode => node.nodeName === '#text';

const isElementNode = (
  node: parse5.AST.Default.Node
): node is parse5.AST.Default.Element => 'tagName' in node;

export type PartType = 'text' | 'attribute';

const litTemplateDeclarations = new Map<
  ts.VariableDeclaration,
  ts.ArrowFunction
>();

const isSoyCompatible = (node: ts.Node) =>
  ts.getJSDocTags(node).some((t) => t.tagName.escapedText === 'soyCompatible');

const isLitTemplateFunctionDeclaration = (
  node: ts.Node
): node is ts.VariableStatement => {
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (
        declaration.initializer !== undefined &&
        ts.isArrowFunction(declaration.initializer) &&
        isSoyCompatible(node)
      ) {
        return true;
      }
    }
  }
  return false;
};

const isLitTemplateFunction = (node: ts.Node): node is ts.ArrowFunction =>
  ts.isArrowFunction(node) && isSoyCompatible(node);

const isLitElement = (node: ts.Node): node is ts.ClassDeclaration =>
  ts.isClassDeclaration(node) &&
  ts.getJSDocTags(node).some((t) => t.tagName.escapedText === 'soyCompatible');

const getVariableDeclaration = (node: ts.Node) => {
  let declaration = node;
  while (declaration !== undefined && !ts.isVariableDeclaration(declaration)) {
    declaration = declaration.parent;
  }
  return declaration;
};

const getRenderMethod = (
  node: ts.ClassDeclaration
): ts.MethodDeclaration | undefined => {
  return node.members.find(
    (m) => ts.isMethodDeclaration(m) && m.name.getText() === 'render'
  ) as ts.MethodDeclaration;
};

const booleanType: SimpleType = {kind: SimpleTypeKind.BOOLEAN};
const numberType: SimpleType = {kind: SimpleTypeKind.NUMBER};
const stringType: SimpleType = {kind: SimpleTypeKind.STRING};
const nullishType: SimpleType = {
  kind: SimpleTypeKind.UNION,
  types: [{kind: SimpleTypeKind.NULL}, {kind: SimpleTypeKind.UNDEFINED}],
};
const arrayType: SimpleType = {
  kind: SimpleTypeKind.ARRAY,
  type: {kind: SimpleTypeKind.ANY},
};

export interface Diagnostic {
  fileName: string;
  line: number;
  character: number;
  message: string;
}

export interface TemplateScope {
  scopes: Array<ts.FunctionLikeDeclarationBase | Set<ts.Declaration>>;
  element?: ts.ClassDeclaration;
}

export class SourceFileConverter {
  diagnostics: Diagnostic[] = [];
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  rootDir: string;
  definedElements: Map<string, string>;

  _stringIncludesSymbol: ts.Symbol;
  _arrayMapSymbol: ts.Symbol;

  constructor(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    rootDir: string,
    definedElements?: Map<string, string>
  ) {
    this.sourceFile = sourceFile;
    this.checker = checker;
    this.rootDir = rootDir;
    this.definedElements = definedElements || new Map();

    const symbols = this.checker.getSymbolsInScope(
      sourceFile,
      ts.SymbolFlags.Variable
    );
    const stringSymbol = symbols.filter((s) => s.name === 'String')[0];
    this._stringIncludesSymbol = stringSymbol.members!.get('includes' as any)!;

    const arraySymbol = symbols.filter((s) => s.name === 'Array')[0];
    this._arrayMapSymbol = arraySymbol.members!.get('map' as any)!;
  }

  convertFile() {
    const localPath = path.relative(this.rootDir, this.sourceFile.fileName);
    const soyNamespace = localPath.replace(/\//g, '.');
    const commands: ast.Command[] = [new ast.Namespace(soyNamespace)];

    ts.forEachChild(this.sourceFile, (node) => {
      if (isLitTemplateFunctionDeclaration(node)) {
        commands.push(...this.convertLitTemplateFunctionDeclaration(node));
      } else if (isLitElement(node)) {
        commands.push(...this.convertLitElement(node));
      }
    });
    return new ast.File(commands);
  }

  convertLitElement(node: ts.ClassDeclaration): ast.Command[] {
    const commands: ast.Command[] = [];
    if (node.name === undefined) {
      this.report(node, 'LitElement classes must be named');
      return commands;
    }
    const className = node.name.getText();
    const tagName = this.getCustomElementName(node);
    const properties = this.getLitElementProperties(node);
    const propertyParams = properties.map(
      (p) =>
        new ast.TemplateParameter(p.name!.getText(), this.getSoyTypeOfNode(p))
    );
    const shadowCallParams = properties.map(
      (p) =>
        new ast.CallParameter(
          p.name!.getText(),
          new ast.Identifier(p.name!.getText())
        )
    );

    const wrapperTemplate = new ast.Template(className, [
      new ast.TemplateParameter('children', 'string'),
      ...propertyParams,
      new ast.RawText(`<${tagName}>\n{$children}\n`),
      new ast.CallCommand(`${className}_shadow`, shadowCallParams),
      new ast.RawText(`</${tagName}>`),
    ]);
    commands.push(wrapperTemplate);

    // get render method
    const render = getRenderMethod(node);
    if (render === undefined) {
      this.report(node, 'no render method found');
      return commands;
    }
    const shadowTemplate = this.convertRenderMethod(render, node, className);
    commands.push(shadowTemplate);
    return commands;
  }

  convertRenderMethod(
    node: ts.MethodDeclaration,
    element: ts.ClassDeclaration,
    className: string
  ): ast.Template {
    const properties = this.getLitElementProperties(element);
    const propertyParams = properties.map(
      (p) =>
        new ast.TemplateParameter(
          p.name!.getText(),
          this.getSoyTypeOfNode(p as ts.PropertyDeclaration)
        )
    );
    return new ast.Template(`${className}_shadow`, [
      ...propertyParams,
      ...this.convertLitTemplateFunctionBody(node.body!, {
        element,
        scopes: [node],
      }),
    ]);
  }

  /**
   * Converts a variable declaration list that's been annotated with
   * `@soyCompatible`.
   */
  convertLitTemplateFunctionDeclaration(
    node: ts.VariableStatement
  ): ast.Command[] {
    const commands: ast.Command[] = [];
    for (const declaration of node.declarationList.declarations) {
      if (
        declaration.initializer !== undefined &&
        isLitTemplateFunction(declaration.initializer)
      ) {
        commands.push(
          this.convertLitTemplateFunction(
            declaration.initializer,
            declaration.name.getText()
          )
        );
      }
    }
    return commands;
  }

  /**
   * Converts a top-level lit-html template function to Soy.
   *
   * Inline functions, such as those passed to Array#map() must be converted
   * with convertLitTemplateFunctionBody.
   */
  convertLitTemplateFunction(
    node: ts.ArrowFunction,
    name: string
  ): ast.Template {
    // Cache this function by it's declaration so we can find references to it
    // later. TODO: is this necessary now that we're loading the std lib?
    const declaration = getVariableDeclaration(node);
    if (declaration !== undefined) {
      litTemplateDeclarations.set(declaration, node);
    } else {
      this.report(node, 'no declaration found');
    }

    const commands: ast.Command[] = [];
    for (const param of node.parameters) {
      const type = this.getSoyTypeOfNode(param);
      const name = param.name.getText();
      if (type === undefined) {
        this.report(param, `parameters must have a declared type`);
      }
      commands.push(new ast.TemplateParameter(name, type));
    }
    commands.push(
      ...this.convertLitTemplateFunctionBody(node.body, {scopes: [node]})
    );
    return new ast.Template(name, commands);
  }

  /**
   * Converts a lit-html template function body, including from top-level
   * functions, LitElement render methods, and inline arrow functions, to an
   * array of Soy commands. This function does not return the Soy Template AST
   * node.
   *
   * @param node The function body to convert. May be a block or a single
   *     lit-html tagged tempate literal expression.
   * @param scope The set of function scopes to look up identifiers
   *     against.
   */
  convertLitTemplateFunctionBody(
    node: ts.ConciseBody,
    scope: TemplateScope
  ): ast.Command[] {
    const commands: ast.Command[] = [];
    if (ts.isBlock(node)) {
      let hasReturn = false;
      for (const statement of node.statements) {
        if (ts.isReturnStatement(statement)) {
          hasReturn = true;
          commands.push(...this.convertReturnStatement(statement, scope));
        } else if (ts.isVariableStatement(statement)) {
          const declarationList = statement.declarationList;
          const isConst = declarationList.flags & ts.NodeFlags.Const;
          if (!isConst) {
            this.report(declarationList, 'non-const variable declaration');
            commands.push(new ast.ErrorExpression());
            continue;
          }
          for (const declaration of statement.declarationList.declarations) {
            const name = declaration.name.getText();
            const initializer = this.convertExpression(
              declaration.initializer!,
              scope
            );
            scope = {
              ...scope,
              scopes: [new Set([declaration]), ...scope.scopes],
            };
            // TODO: validate the type
            // const tsType = this.checker.getTypeAtLocation(declaration);
            // const soyType = this.getSoyType(tsType);
            commands.push(new ast.LetCommand(name, initializer));
          }
        } else {
          this.report(statement, 'unsupported statement');
        }
      }
      if (!hasReturn) {
        this.report(node, 'litTemplates must return a TemplateResult');
      }
      return commands;
    }
    if (!this.isLitHtmlTaggedTemplate(node)) {
      this.report(node, 'litTemplates must return a TemplateResult');
      return commands;
    }
    commands.push(...this.convertLitTaggedTemplateExpression(node, scope));
    return commands;
  }

  convertReturnStatement(
    node: ts.ReturnStatement,
    scope: TemplateScope
  ): ast.Command[] {
    if (
      node.expression === undefined ||
      !this.isLitHtmlTaggedTemplate(node.expression)
    ) {
      this.report(node, 'litTemplates must return a TemplateResult');
      return [];
    }
    return this.convertLitTaggedTemplateExpression(node.expression, scope);
  }

  convertLitTaggedTemplateExpression(
    templateLiteral: ts.TaggedTemplateExpression,
    scope: TemplateScope
  ): ast.Command[] {
    const commandStack: ast.Command[][] = [[]];
    let commands: ast.Command[] = commandStack[0];

    const template = templateLiteral.template as ts.TemplateLiteral;
    const marker = '{{-lit-html-}}';
    const markerRegex = /{{-lit-html-}}/g;
    const lastAttributeNameRegex =
      /([ \x09\x0a\x0c\x0d])([^\0-\x1F\x7F-\x9F "'>=/]+)([ \x09\x0a\x0c\x0d]*=[ \x09\x0a\x0c\x0d]*(?:[^ \x09\x0a\x0c\x0d"'`<>=]*|"[^"]*|'[^']*))$/;

    const strings: string[] = ts.isNoSubstitutionTemplateLiteral(template)
      ? [template.text]
      : [
          template.head.text,
          ...template.templateSpans.map((s) => s.literal.text),
        ];
    const expressions = ts.isNoSubstitutionTemplateLiteral(template)
      ? []
      : [...template.templateSpans.map((s) => s.expression)];
    const html = strings.join(marker);
    const fragment = parse5.parseFragment(html, {locationInfo: true});
    let partTypes: PartType[] = [];

    // commands.push(new ast.RawText(strings[0]));
    traverseHtml(fragment, {
      pre: (node: parse5.AST.Default.Node) => {
        if (isTextNode(node)) {
          const text = node.value;
          const textLiterals = text.split(markerRegex);
          commands.push(new ast.RawText(textLiterals[0]));
          for (const textLiteral of textLiterals.slice(1)) {
            commands.push(
              ...this.convertTextExpression(
                expressions[partTypes.length],
                scope
              )
            );
            commands.push(new ast.RawText(textLiteral));
            partTypes.push('text');
          }
        } else if (isElementNode(node)) {
          const isDefined = this.definedElements.has(node.tagName);
          if (isDefined) {
            const childrenCommands: ast.Command[] = [];
            const block = new ast.Block(childrenCommands);
            const childrenParameter = new ast.CallParameter(
              'children',
              block,
              'html'
            );
            commands.push(
              new ast.CallCommand(this.definedElements.get(node.tagName)!, [
                childrenParameter,
              ])
            );
            commandStack.push(commands);
            commands = childrenCommands;
          } else {
            commands.push(new ast.RawText(`<${node.tagName}`));
          }
          for (let {name, value} of node.attrs) {
            if (name.startsWith('.')) {
              // Need to get name from source to ensure proper casing.
              const attributeName = lastAttributeNameRegex.exec(strings[partTypes.length])![2];
              const propertyName = attributeName.slice(1);
              const reflectedAttributeName = getReflectedAttributeName(propertyName, node.tagName);
              if (reflectedAttributeName !== undefined) {
                name = reflectedAttributeName;
              } else {
                partTypes.push('attribute');
                continue;
              }
            } else if (
              name.startsWith('?') ||
              name.startsWith('@')
            ) {
              // TODO: this likely shouldn't be a warning. Not rendering all
              // attribute-position bindings is how things will just work, but
              // this isn't developed out yet, so make a warning for now.
              this.report(
                templateLiteral,
                `unsupported binding type: ${name[0]}`
              );
              partTypes.push('attribute');
              continue;
            }
            const textLiterals = value.split(markerRegex);
            commands.push(new ast.RawText(` ${name}="${textLiterals[0]}`));
            for (const textLiteral of textLiterals.slice(1)) {
              commands.push(
                this.convertAttributeExpression(
                  expressions[partTypes.length],
                  scope
                )
              );
              commands.push(new ast.RawText(textLiteral));
              partTypes.push('attribute');
            }
            commands.push(new ast.RawText('"'));
          }
          if (!isDefined) {
            commands.push(new ast.RawText(`>`));
          }
        }
      },
      post: (node: parse5.AST.Default.Node) => {
        if (isElementNode(node)) {
          const isDefined = this.definedElements.has(node.tagName);
          if (isDefined) {
            commandStack.pop();
            commands = commandStack[commandStack.length - 1];
          } else if (node.__location!.endTag !== undefined) {
            commands.push(new ast.RawText(`</${node.tagName}>`));
          }
        }
      },
    });
    return commandStack[0];
  }

  /*
   * Converts text-position expressions to commands.
   */
  convertTextExpression(
    node: ts.Expression,
    scope: TemplateScope
  ): ast.Command[] {
    if (ts.isTaggedTemplateExpression(node)) {
      if (this.isLitHtmlTaggedTemplate(node)) {
        return this.convertLitTaggedTemplateExpression(node, scope);
      }
      this.report(
        node,
        'template tags must be named imports from the modules' +
          ' "lit-html" or "lit-element"'
      );
      return [];
    }
    if (ts.isConditionalExpression(node)) {
      const condition = this.convertExpression(node.condition, scope);
      const whenTrue = this.convertTextExpression(node.whenTrue, scope);
      const whenFalse = this.convertTextExpression(node.whenFalse, scope);
      return [new ast.IfCommand(condition, whenTrue, whenFalse)];
    }
    if (ts.isCallExpression(node)) {
      const call = node as ts.CallExpression;
      const func = call.expression;
      const funcSymbol = this.checker.getSymbolAtLocation(func);
      const funcDeclaration = funcSymbol && funcSymbol.declarations[0];

      if (
        funcDeclaration &&
        funcDeclaration === this._arrayMapSymbol.declarations[0]
      ) {
        if (!ts.isPropertyAccessExpression(func)) {
          this.report(call, 'Array#map must be called as a method');
          return [new ast.ErrorExpression()];
        }
        const receiver = func.expression;
        const args = call.arguments;
        if (args.length !== 1) {
          this.report(call, 'only one argument is allowed to Array#map()');
          return [new ast.ErrorExpression()];
        }
        const mapper = args[0];
        if (!ts.isArrowFunction(mapper)) {
          this.report(node, 'Array#map must be passed an arrow function');
          return [new ast.ErrorExpression()];
        }
        const loopId = mapper.parameters[0].name.getText();
        const loopExpr = this.convertExpression(receiver, scope);
        const template = this.convertLitTemplateFunctionBody(mapper.body, {
          ...scope,
          scopes: [mapper, ...scope.scopes],
        });
        return [new ast.ForCommand(loopId, loopExpr, template)];
      }

      if (ts.isIdentifier(call.expression)) {
        // Check to see if this is a template function call
        const declaration = this.getIdentifierDeclaration(
          call.expression as ts.Identifier
        );
        if (
          declaration !== undefined &&
          declaration.kind === ts.SyntaxKind.VariableDeclaration
        ) {
          const litTemplate = litTemplateDeclarations.get(
            declaration as ts.VariableDeclaration
          );
          if (litTemplate !== undefined) {
            return [new ast.CallCommand(call.expression.getText(), [])];
          }
        }
      }
    }
    return [new ast.Print(this.convertExpression(node, scope))];
  }

  /*
   * Converts attribute-position expressions to commands.
   */
  convertAttributeExpression(
    node: ts.Expression,
    scope: TemplateScope
  ): ast.Command {
    return new ast.Print(this.convertExpression(node, scope));
  }

  /**
   * Converts inner expressions to Soy expressions.
   *
   * @param node The expression to convert.
   * @param scope The set of function scopes to look up identifiers
   *     against.
   */
  convertExpression(node: ts.Expression, scope: TemplateScope): ast.Expression {
    switch (node.kind) {
      case ts.SyntaxKind.ParenthesizedExpression:
        return new ast.Paren(
          this.convertExpression(
            (node as ts.ParenthesizedExpression).expression,
            scope
          )
        );
      case ts.SyntaxKind.Identifier:
        if (this.isInScope(node as ts.Identifier, scope)) {
          return new ast.Identifier(node.getText());
        }
        this.report(node, 'identifier references non-local parameter');
        break;
      case ts.SyntaxKind.StringLiteral:
        return new ast.StringLiteral(node.getText());
      case ts.SyntaxKind.NumericLiteral:
        return new ast.NumberLiteral(node.getText());
      case ts.SyntaxKind.TrueKeyword:
      case ts.SyntaxKind.FalseKeyword:
        return new ast.BooleanLiteral(node.getText());
      case ts.SyntaxKind.NullKeyword:
      case ts.SyntaxKind.UndefinedKeyword:
        return new ast.NullLiteral();
      case ts.SyntaxKind.ObjectLiteralExpression: {
        const obj = node as ts.ObjectLiteralExpression;
        const entries: Array<[string, ast.Expression]> = obj.properties.map(
          (p) => {
            if (ts.isPropertyAssignment(p)) {
              const name = p.name.getText();
              const value = p.initializer;
              return [name, this.convertExpression(value, scope)];
            } else {
              this.report(p, 'unsupported object literal member');
              return ['', new ast.ErrorExpression()];
            }
          }
        );
        return new ast.Record(entries);
      }
      case ts.SyntaxKind.TaggedTemplateExpression:
        this.report(node, 'template are not supported here');
        break;
      case ts.SyntaxKind.CallExpression: {
        const call = node as ts.CallExpression;
        const func = call.expression;
        const funcSymbol = this.checker.getSymbolAtLocation(func);
        const funcDeclaration = funcSymbol && funcSymbol.declarations[0];

        // Rewrite String.contains.
        // TODO: move this to a lookup
        if (
          funcDeclaration &&
          funcDeclaration === this._stringIncludesSymbol.declarations[0]
        ) {
          if (!ts.isPropertyAccessExpression(func)) {
            this.report(call, 'String#includes must be called as a method');
            return new ast.ErrorExpression();
          }
          const receiver = func.expression;
          const args = call.arguments;
          if (args.length !== 1) {
            this.report(
              call,
              'only one argument is allowed to String#includes()'
            );
            return new ast.ErrorExpression();
          }
          const arg = args[0];
          return new ast.CallExpression('strContains', [
            this.convertExpression(receiver, scope),
            this.convertExpression(arg, scope),
          ]);
        }
        this.report(node, `unsupported call`);
        return new ast.ErrorExpression();
      }
      case ts.SyntaxKind.BinaryExpression: {
        const operator = (node as ts.BinaryExpression).operatorToken;
        const soyOperator = this.getSoyBinaryOperator(operator);
        if (soyOperator !== undefined) {
          const left = this.convertExpression(
            (node as ts.BinaryExpression).left,
            scope
          );
          const right = this.convertExpression(
            (node as ts.BinaryExpression).right,
            scope
          );
          return new ast.BinaryOperator(soyOperator, left, right);
        }
        return new ast.ErrorExpression();
      }
      case ts.SyntaxKind.ConditionalExpression:
        return new ast.Ternary(
          this.convertExpression(
            (node as ts.ConditionalExpression).condition,
            scope
          ),
          this.convertExpression(
            (node as ts.ConditionalExpression).whenTrue,
            scope
          ),
          this.convertExpression(
            (node as ts.ConditionalExpression).whenFalse,
            scope
          )
        );
      case ts.SyntaxKind.PrefixUnaryExpression: {
        const soyOperator = this.getSoyUnaryOperator(
          node as ts.PrefixUnaryExpression
        );
        if (soyOperator !== undefined) {
          return new ast.UnaryOperator(
            soyOperator,
            this.convertExpression(
              (node as ts.PrefixUnaryExpression).operand,
              scope
            )
          );
        }
        return new ast.ErrorExpression();
      }
      case ts.SyntaxKind.PropertyAccessExpression: {
        const receiver = (node as ts.PropertyAccessExpression).expression;
        if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
          if (scope.element === undefined) {
            this.report(node, 'this keyword outside of a LitElement');
            return new ast.ErrorExpression();
          }
          const symbol = this.checker.getSymbolAtLocation(node);
          if (symbol === undefined) {
            this.report(node, 'unknown class property');
            return new ast.ErrorExpression();
          }
          const declaration = symbol.declarations[0];
          for (const member of scope.element.members) {
            if (declaration === member) {
              // TODO: check that it's a decorated property
              const name = (node as ts.PropertyAccessExpression).name;
              return new ast.Identifier(name.getText());
            }
          }
        }
        return this.convertPropertyAccessExpression(
          node as ts.PropertyAccessExpression,
          scope
        );
      }
    }
    this.report(node, `unsuported expression: ${node.getText()}`);
    return new ast.ErrorExpression();
  }

  convertPropertyAccessExpression(
    node: ts.PropertyAccessExpression,
    scope: TemplateScope
  ): ast.Expression {
    const receiver = (node as ts.PropertyAccessExpression).expression;
    const receiverType = this.checker.getTypeAtLocation(receiver);
    const name = (node as ts.PropertyAccessExpression).name.getText();

    if (receiverType !== undefined) {
      if (isAssignableToType(stringType, receiverType, this.checker)) {
        if (name === 'length') {
          return new ast.CallExpression('strLen', [
            this.convertExpression(receiver, scope),
          ]);
        }
      }
      if (isAssignableToType(arrayType, receiverType, this.checker)) {
        if (name === 'length') {
          return new ast.CallExpression('length', [
            this.convertExpression(receiver, scope),
          ]);
        }
      }
    } else {
      this.report(node, 'unknown receiver type');
    }
    return new ast.PropertyAccess(
      this.convertExpression(receiver, scope),
      name
    );
  }

  isLitHtmlTaggedTemplate(node: ts.Node): node is ts.TaggedTemplateExpression {
    return (
      ts.isTaggedTemplateExpression(node) &&
      this.isImportOf(node.tag, 'html', ['lit-html', 'lit-element'])
    );
  }

  isLitElementProperty(node: ts.PropertyDeclaration) {
    const decorators = node.decorators;
    if (decorators === undefined) {
      return false;
    }
    for (const decorator of decorators) {
      const expr = decorator.expression;
      if (!ts.isCallExpression(expr)) {
        return false;
      }
      const receiver = expr.expression;
      if (
        this.isImportOf(receiver, 'property', 'lit-element/lib/decorators.js')
      ) {
        return true;
      }
    }
    return false;
  }

  getLitElementProperties(node: ts.ClassDeclaration) {
    return node.members.filter(
      (m) => ts.isPropertyDeclaration(m) && this.isLitElementProperty(m)
    ) as ts.PropertyDeclaration[];
  }

  isInScope(node: ts.Identifier, scope: TemplateScope) {
    for (const s of scope.scopes) {
      if (s instanceof Set) {
        const declaration = this.getIdentifierDeclaration(node);
        if (declaration !== undefined && s.has(declaration)) {
          return true;
        }
      } else if (this.isParameterOf(node as ts.Identifier, s)) {
        return true;
      }
    }
    return false;
  }

  isParameterOf(node: ts.Identifier, f: ts.FunctionLikeDeclarationBase) {
    const declaration = this.getIdentifierDeclaration(node);
    return (
      declaration !== undefined &&
      ts.isParameter(declaration) &&
      declaration.parent === f
    );
  }

  /**
   * Returns true if `node` is an identifier that references the import named
   * `name` from a module with specifier `specifier`.
   *
   * @param node The node to check. It can be any node type but this will return
   *     false for non-Itentifiers.
   * @param name The imported symbol name.
   * @param specifier. Either a single import specifier, or an array of
   *     specifiers.
   * @example
   *
   * ```
   *   if (isImportOf(node.tag, 'html', ['lit-html', 'lit-element'])) {
   *     // node is a lit-html template
   *   }
   * ```
   */
  isImportOf(node: ts.Node, name: string, specifier: string | string[]) {
    if (!ts.isIdentifier(node)) {
      return false;
    }
    const symbol = this.checker.getSymbolAtLocation(node);
    if (symbol === undefined || symbol.declarations.length === 0) {
      return false;
    }
    const declaration = symbol.declarations[0];
    if (
      declaration.kind !== ts.SyntaxKind.ImportSpecifier ||
      declaration.parent.kind !== ts.SyntaxKind.NamedImports
    ) {
      return false;
    }
    const imports = declaration.parent as ts.NamedImports;
    const importDeclaration = imports.parent.parent;
    const importName = declaration.getText();
    const specifierNode = importDeclaration.moduleSpecifier as ts.StringLiteral;
    const specifierText = specifierNode.text;
    if (Array.isArray(specifier)) {
      for (const s of specifier) {
        if (importName === name && specifierText === s) {
          return true;
        }
      }
      return false;
    } else {
      return importName === name && specifierText === specifier;
    }
  }

  getIdentifierDeclaration(node: ts.Identifier) {
    const symbol = this.checker.getSymbolAtLocation(node)!;
    if (symbol === undefined) {
      this.report(node, `unknown identifier: ${node.getText()}`);
      return;
    }
    const declarations = symbol.getDeclarations();
    if (declarations === undefined) {
      this.report(node, `unknown identifier: ${node.getText()}`);
      return;
    }
    if (declarations.length > 1) {
      this.report(node, 'multiple declarations');
    }
    return declarations[0];
  }

  /**
   * Intended to return the Soy type equivalent to the TypeScript type of the
   * given node. Beause Soy has a fairly expressive type system with union
   * types, record types, and generics on list and map, we actually want to
   * traverse and convert the type AST here. For now we'll use some simple
   * assignability checks.
   *
   * @param node A node like a ParameterDeclaration that has a .type property.
   */
  getSoyTypeOfNode(node: ts.HasType): string | undefined {
    const typeNode = node.type;
    if (typeNode === undefined) {
      return undefined;
    }
    const type = this.checker.getTypeAtLocation(typeNode);
    const soyType = this.getSoyType(type);
    if (soyType === undefined) {
      this.report(node, 'unknown type');
    }
    return soyType;
  }

  getSoyType(type: ts.Type): string | undefined {
    if (isAssignableToType(type, booleanType, this.checker)) {
      return 'bool';
    } else if (isAssignableToType(type, numberType, this.checker)) {
      return 'number';
    } else if (isAssignableToType(type, stringType, this.checker)) {
      return 'string';
    } else if (isAssignableToType(type, nullishType, this.checker)) {
      return 'null';
    } else if (isAssignableToType(type, arrayType, this.checker)) {
      const isObjectType = type.flags & ts.TypeFlags.Object;
      if (!isObjectType) {
        throw new Error('unexpected type');
      }
      const isReferenceType =
        (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference;
      if (!isReferenceType) {
        throw new Error('unexpected type');
      }
      const typeArguments = (type as ts.TypeReference).typeArguments;
      if (typeArguments === undefined || typeArguments.length === 0) {
        return 'list';
      }
      if (typeArguments.length === 1) {
        return `list<${this.getSoyType(typeArguments[0])}>`;
      }
    }
    return undefined;
  }

  getSoyBinaryOperator(
    operator: ts.Token<ts.BinaryOperator>
  ): string | undefined {
    switch (operator.kind) {
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return 'and';
      case ts.SyntaxKind.BarBarToken:
        return 'or';
      case ts.SyntaxKind.PlusToken:
      case ts.SyntaxKind.MinusToken:
      case ts.SyntaxKind.AsteriskToken:
      case ts.SyntaxKind.SlashToken:
      case ts.SyntaxKind.PercentToken:
      case ts.SyntaxKind.GreaterThanToken:
      case ts.SyntaxKind.LessThanToken:
      case ts.SyntaxKind.GreaterThanEqualsToken:
      case ts.SyntaxKind.LessThanEqualsToken:
      case ts.SyntaxKind.EqualsEqualsToken:
      case ts.SyntaxKind.ExclamationEqualsToken:
        return operator.getText();
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        this.report(operator, '=== is disallowed. Use ==');
        return undefined;
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        this.report(operator, '!== is disallowed. Use !=');
        return undefined;
    }
    this.report(operator, 'unsupported operator');
    return undefined;
  }

  getSoyUnaryOperator(expr: ts.PrefixUnaryExpression): string | undefined {
    switch (expr.operator) {
      case ts.SyntaxKind.ExclamationToken:
        return 'not';
      case ts.SyntaxKind.MinusToken:
        return '-';
    }
    this.report(expr, 'unsupported operator');
    return undefined;
  }

  getCustomElementName(node: ts.ClassDeclaration): string | undefined {
    if (node.decorators === undefined) {
      return;
    }
    for (const decorator of node.decorators) {
      if (!ts.isCallExpression(decorator.expression)) {
        continue;
      }
      const call = decorator.expression;
      if (
        this.isImportOf(
          call.expression,
          'customElement',
          'lit-element/lib/decorators.js'
        )
      ) {
        const args = call.arguments;
        if (args.length !== 1) {
          this.report(call, 'wrong number of arguments to customElement');
          return;
        }
        const arg = args[0];
        if (!ts.isStringLiteral(arg)) {
          this.report(call, 'customElement argument must be a string literal');
          return;
        }
        return arg.text;
      }
    }
    return;
  }

  report(node: ts.Node, message: string) {
    const {line, character} = this.sourceFile.getLineAndCharacterOfPosition(
      node.getStart()
    );
    this.diagnostics.push({
      fileName: this.sourceFile.fileName,
      line,
      character,
      message,
    });
  }
}
