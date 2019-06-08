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
import {getPartTypes} from './get-part-types.js';

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

export class SourceFileConverter {
  diagnostics: Diagnostic[] = [];
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  rootDir: string;

  _stringIncludesSymbol: ts.Symbol;

  constructor(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    rootDir: string
  ) {
    this.sourceFile = sourceFile;
    this.checker = checker;
    this.rootDir = rootDir;

    const symbols = this.checker.getSymbolsInScope(
      sourceFile,
      ts.SymbolFlags.Variable
    );
    const stringSymbol = symbols.filter((s) => s.name === 'String')[0];
    this._stringIncludesSymbol = stringSymbol.members!.get('includes' as any)!;
  }

  get soyNamespace() {
    const localPath = path.relative(this.rootDir, this.sourceFile.fileName);
    return localPath.replace(/\//g, '.');
  }

  convertFile() {
    const commands: ast.Command[] = [
      new ast.Namespace(this.soyNamespace)
    ];

    ts.forEachChild(this.sourceFile, (node) => {
      if (isLitTemplateFunctionDeclaration(node)) {
        commands.push(...this.convertLitTemplateFunctionDeclaration(node));
      } else if (isLitElement(node)) {
        commands.push(...this.convertLitElement(node));
      }
    });
    return new ast.File(commands);
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

  convertLitElement(node: ts.ClassDeclaration): ast.Command[] {
    const commands: ast.Command[] = [];
    if (node.name === undefined) {
      this.report(node, 'LitElement classes must be named');
      return commands;
    }
    const className = node.name.getText();
    const tagName = this.getCustomElementName(node);
    const wrapperTemplate = new ast.Template(className, [
      new ast.Param('children', 'string'),
      new ast.RawText(`<${tagName}>{$children}</${tagName}>`)
    ]);
    commands.push(wrapperTemplate);

    // get render method
    const render = getRenderMethod(node);
    if (render === undefined) {
      this.report(node, 'no render method found');
      return commands;
    }
    const shadowTemplate = this.convertRenderMethod(render, className);
    commands.push(shadowTemplate);
    return commands;
  }

  convertRenderMethod(node: ts.MethodDeclaration, className: string): ast.Template {
    return new ast.Template(`${className}_shadow`, 
        this.convertLitTemplateFunctionBody(node.body!, node));
  }

  /**
   * Converts a variable declaration list that's been annotated with
   * `@soyCompatible`. Any
   */
  convertLitTemplateFunctionDeclaration(node: ts.VariableStatement): ast.Command[] {
    const commands: ast.Command[] = []
    for (const declaration of node.declarationList.declarations) {
      if (
        declaration.initializer !== undefined &&
        isLitTemplateFunction(declaration.initializer)
      ) {
        commands.push(this.convertLitTemplateFunction(declaration.initializer, declaration.name.getText()));
      }
    }
    return commands;
  }

  convertLitTemplateFunction(node: ts.ArrowFunction, name: string): ast.Template {
    // Cache this function by it's declaration so we can find references to it
    // later. TODO: is this necessary now that we're loading the std lib?
    const declaration = getVariableDeclaration(node);
    if (declaration !== undefined) {
      litTemplateDeclarations.set(declaration, node);
    } else {
      this.report(node, 'no declaration found');
    }

    const commands: ast.Command[] = []
    for (const param of node.parameters) {
      const type = this.getSoyTypeOfNode(param);
      const name = param.name.getText();
      if (type === undefined) {
        this.report(param, `parameters must have a declared type`);
      }
      commands.push(new ast.Param(name, type));
    }
    commands.push(...this.convertLitTemplateFunctionBody(node.body, node));
    return new ast.Template(name, commands);
  }

  convertLitTemplateFunctionBody(
    node: ts.ConciseBody,
    f: ts.FunctionLikeDeclarationBase
  ): ast.Command[] {
    const commands: ast.Command[] = [];
    if (ts.isBlock(node)) {
      let hasReturn = false;
      ts.forEachChild(node, (n) => {
        if (ts.isReturnStatement(n)) {
          hasReturn = true;
          commands.push(...this.convertReturnStatement(n, f));
        } else {
          this.report(n, 'unsupported statement');
        }
      });
      if (!hasReturn) {
        this.report(node, 'litTemplates must return a TemplateResult');
      }
      return commands;
    }
    if (!this.isLitHtmlTemplate(node)) {
      this.report(node, 'litTemplates must return a TemplateResult');
      return commands;
    }
    commands.push(...this.convertLitTemplateExpression(node, f));
    return commands;
  }

  convertReturnStatement(
    node: ts.ReturnStatement,
    f: ts.FunctionLikeDeclarationBase
  ): ast.Command[] {
    if (node.expression === undefined || !this.isLitHtmlTemplate(node.expression)) {
      this.report(node, 'litTemplates must return a TemplateResult');
      return [];
    }
    return this.convertLitTemplateExpression(node.expression, f);
  }

  isLitHtmlTemplate(node: ts.Node): node is ts.TaggedTemplateExpression {
    return ts.isTaggedTemplateExpression(node) &&
        this.isImportOf(node.tag, 'html', ['lit-html', 'lit-element']);
  }

  convertLitTemplateExpression(
    node: ts.TaggedTemplateExpression,
    f: ts.FunctionLikeDeclarationBase
  ): ast.Command[] {
    const commands: ast.Command[] = [];

    const template = node.template as ts.TemplateExpression;
    if (template.head !== undefined) {
      const partTypes = getPartTypes(node);
      if (partTypes.length !== template.templateSpans.length) {
        throw new Error(`wrong number of parts: expected: ${template.templateSpans.length} got: ${partTypes.length}`);
      }

      commands.push(new ast.RawText(template.head.text));
      for (let i = 0; i < template.templateSpans.length; i++) {
        const span = template.templateSpans[i];
        const partType = partTypes[i];
        if (partType === 'text') {
          commands.push(...this.convertTextExpression(span.expression, f));
        } else {
          commands.push(this.convertAttributeExpression(span.expression, f));
        }
        commands.push(new ast.RawText(span.literal.text));
      }
    } else {
      commands.push(new ast.RawText((template as any).text));
    }
    return commands;
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

  /*
   * Converts text-position expressions to commands.
   */
  convertTextExpression(
    node: ts.Expression,
    f: ts.FunctionLikeDeclarationBase): ast.Command[] {
    if (ts.isTaggedTemplateExpression(node)) {
      if (this.isLitHtmlTemplate(node)) {
        return this.convertLitTemplateExpression(node, f);
      }
      this.report(
        node,
        'template tags must be named imports from the modules' +
          ' "lit-html" or "lit-element"'
      );
      return [];
    }
    if (ts.isConditionalExpression(node)) {
      const condition = this.convertExpression(node.condition, f);
      const whenTrue = this.convertTextExpression(node.whenTrue, f);
      const whenFalse = this.convertTextExpression(node.whenFalse, f);
      return [new ast.IfCommand(condition, whenTrue, whenFalse)];
    }
    if (ts.isCallExpression(node)) {
      const call = node as ts.CallExpression;
      // if (!ts.isIdentifier(call.expression)) {
      //   this.report(node, 'only template functions can be called');
      //   return new ast.Empty();
      // }
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
    return [new ast.Print(this.convertExpression(node, f))];
  }

  /*
   * Converts attribute-position expressions to commands.
   */
  convertAttributeExpression(
    node: ts.Expression,
    f: ts.FunctionLikeDeclarationBase): ast.Command {
    return new ast.Print(this.convertExpression(node, f));
  }

  isParameterOf(node: ts.Identifier, f: ts.FunctionLikeDeclarationBase) {
    const declaration = this.getIdentifierDeclaration(node);
    return declaration !== undefined &&
      ts.isParameter(declaration) &&
      declaration.parent === f;
  }

  /**
   * Converts inner expressions to Soy expressions.
   */
  convertExpression(
    node: ts.Expression,
    f: ts.FunctionLikeDeclarationBase): ast.Expression {
  
    switch (node.kind) {
      case ts.SyntaxKind.ParenthesizedExpression:
        return new ast.Paren(this.convertExpression((node as ts.ParenthesizedExpression).expression, f));
      case ts.SyntaxKind.Identifier:
        if (this.isParameterOf(node as ts.Identifier, f)) {
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
      case ts.SyntaxKind.TaggedTemplateExpression:
        this.report(node, 'template are not supported here');
        break;
      case ts.SyntaxKind.CallExpression: {
        const call = node as ts.CallExpression;
        const func = call.expression;
        const funcSymbol = this.checker.getSymbolAtLocation(func);

        // Rewrite String.contains.
        // TODO: move this to a lookup
        if (funcSymbol === this._stringIncludesSymbol) {
          if (!ts.isPropertyAccessExpression(func)) {
            this.report(call, 'String#includes must be called as a method');
            return new ast.Empty();
          }
          const receiver = func.expression;
          const args = call.arguments;
          if (args.length !== 1) {
            this.report(
              call,
              'only one argument is allowed to String#includes()'
            );
            return new ast.Empty();
          }
          const arg = args[0];
          return new ast.CallExpression('strContains', [
            this.convertExpression(receiver, f),
            this.convertExpression(arg, f)]);
        }
        this.report(node, `unsupported call`);
        return new ast.Empty();
      }
      case ts.SyntaxKind.BinaryExpression: {
        const operator = (node as ts.BinaryExpression).operatorToken;
        const soyOperator = this.getSoyBinaryOperator(operator);
        if (soyOperator !== undefined) {
          const left = this.convertExpression((node as ts.BinaryExpression).left, f);
          const right = this.convertExpression((node as ts.BinaryExpression).right, f);
          return new ast.BinaryOperator(soyOperator, left, right);
        }
        return new ast.Empty();
      }
      case ts.SyntaxKind.ConditionalExpression:
        return new ast.Ternary(
        this.convertExpression((node as ts.ConditionalExpression).condition, f),
        this.convertExpression((node as ts.ConditionalExpression).whenTrue, f),
        this.convertExpression((node as ts.ConditionalExpression).whenFalse, f)
        );
      case ts.SyntaxKind.PrefixUnaryExpression: {
        const soyOperator = this.getSoyUnaryOperator(node as ts.PrefixUnaryExpression);
        if (soyOperator !== undefined) {
          return new ast.UnaryOperator(soyOperator,
            this.convertExpression((node as ts.PrefixUnaryExpression).operand, f));
        }
        return new ast.Empty();
      }
      case ts.SyntaxKind.PropertyAccessExpression: {
        return this.convertPropertyAccessExpression(
          node as ts.PropertyAccessExpression,
          f
        );
      }
    }
    this.report(node, `unsuported expression: ${node.getText()}`);
    return new ast.Empty();
  }

  convertPropertyAccessExpression(
    node: ts.PropertyAccessExpression,
    f: ts.FunctionLikeDeclarationBase
  ): ast.Expression {
    const receiver = (node as ts.PropertyAccessExpression).expression;
    const receiverType = this.checker.getTypeAtLocation(receiver);
    const name = (node as ts.PropertyAccessExpression).name.getText();

    if (receiverType !== undefined) {
      if (isAssignableToType(stringType, receiverType, this.checker)) {
        if (name === 'length') {
          return new ast.CallExpression('strLen', [this.convertExpression(receiver, f)]);
        }
      }
      if (isAssignableToType(arrayType, receiverType, this.checker)) {
        if (name === 'length') {
          return new ast.CallExpression('length', [this.convertExpression(receiver, f)]);
        }
      }
    } else {
      this.report(node, 'unknown receiver type');
    }
    return new ast.PropertyAccess(this.convertExpression(receiver, f), name);
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

  getSoyBinaryOperator(operator: ts.Token<ts.BinaryOperator>): string|undefined {
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

  getSoyUnaryOperator(expr: ts.PrefixUnaryExpression): string|undefined {
    switch (expr.operator) {
      case ts.SyntaxKind.ExclamationToken:
        return 'not';
      case ts.SyntaxKind.MinusToken:
        return '-';
    }
    this.report(expr, 'unsupported operator');
    return undefined;
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
