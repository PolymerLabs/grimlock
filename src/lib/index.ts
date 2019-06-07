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
import {soy} from './utils.js';
import * as path from 'path';

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
  buffer: string[] = [];
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

  checkFile() {
    this.out(`{namespace ${this.soyNamespace}}\n`);

    ts.forEachChild(this.sourceFile, (node) => {
      if (isLitTemplateFunctionDeclaration(node)) {
        this.checkLitTemplateFunctionDeclaration(node);
      } else if (isLitElement(node)) {
        this.checkLitElement(node);
      }
    });
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

  checkLitElement(node: ts.ClassDeclaration) {
    if (node.name === undefined) {
      this.report(node, 'LitElement classes must be named');
      return;
    }
    const className = node.name.getText();
    const tagName = this.getCustomElementName(node);
    this.out(soy`
      {template .${className}}
        {$param children: string}
        <${tagName}>{$children}</${tagName}>
      {/template}
      `);
    // get render method
    const render = getRenderMethod(node);
    if (render === undefined) {
      this.report(node, 'no render method found');
      return;
    }
    this.checkRenderMethod(render, className);
  }

  checkRenderMethod(node: ts.MethodDeclaration, className: string) {
    this.out(soy`
      {template .${className}_shadow}
    `);

    const statements = node.body!.statements;
    if (statements.length !== 1) {
      this.report(node.body!, 'we only support a single return statement');
    }
    const statement1 = statements[0];
    if (ts.isReturnStatement(statement1)) {
      const expression = statement1.expression;
      if (expression!.kind !== ts.SyntaxKind.TaggedTemplateExpression) {
        this.report(node, 'litTemplates must directly return a TemplateResult');
      }
      this.checkLitTemplateExpression(
        expression as ts.TaggedTemplateExpression,
        node
      );
    }

    this.out(soy`
      {/template}
    `);
  }

  checkLitTemplateFunctionDeclaration(node: ts.VariableStatement) {
    for (const declaration of node.declarationList.declarations) {
      if (
        declaration.initializer !== undefined &&
        isLitTemplateFunction(declaration.initializer)
      ) {
        this.checkLitTemplateFunction(declaration.initializer);
      }
    }
  }

  checkLitTemplateFunction(node: ts.ArrowFunction) {
    const declaration = getVariableDeclaration(node);
    if (declaration !== undefined) {
      litTemplateDeclarations.set(declaration, node);
    } else {
      this.report(node, 'no declaration found');
    }

    this.out(
      `\n{template .${(node.parent as ts.VariableDeclaration).name.getText()}}\n`
    );
    // TODO: check parameters
    for (const param of node.parameters) {
      const type = this.getSoyTypeOfNode(param);
      const name = param.name.getText();
      if (type === undefined) {
        this.report(param, `parameters must have a declared type`);
      }
      this.out(`  {@param ${name}${type === undefined ? '' : `: ${type}`}}\n`);
    }

    // TODO: check type parameters?
    node.typeParameters;

    // check body
    this.checkLitTemplateBody(node.body, node);
    this.out(`\n{/template}\n`);
  }

  checkLitTemplateBody(
    node: ts.ConciseBody,
    f: ts.FunctionLikeDeclarationBase
  ) {
    if (ts.isBlock(node)) {
      let hasReturn = false;
      ts.forEachChild(node, (n) => {
        hasReturn = hasReturn || this.checkLitTemplateStatement(n, f);
      });
      if (!hasReturn) {
        this.report(node, 'litTemplates must return a TemplateResult');
      }
      return;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      this.checkLitTemplateExpression(node, f);
      return;
    }
    this.report(node, 'litTemplates must return a TemplateResult');
  }

  checkLitTemplateStatement(
    node: ts.Node,
    f: ts.FunctionLikeDeclarationBase
  ): boolean {
    if (ts.isReturnStatement(node)) {
      if (node.expression === undefined) {
        this.report(node, 'litTemplates must return a TemplateResult');
        return true;
      }
      if (ts.isTaggedTemplateExpression(node.expression)) {
        this.checkLitTemplateExpression(node.expression, f);
        return true;
      }
    }
    this.report(node, 'unsupported statement');
    return false;
  }

  checkIsLitHtmlTag(tag: ts.Node) {
    if (this.isImportOf(tag, 'html', ['lit-html', 'lit-element'])) {
      return true;
    }
    this.report(
      tag,
      'template tags must be named imports from the modules' +
        ' "lit-html" or "lit-element"'
    );
    return false;
  }

  checkLitTemplateExpression(
    node: ts.TaggedTemplateExpression,
    f: ts.FunctionLikeDeclarationBase
  ) {
    if (!this.checkIsLitHtmlTag(node.tag)) {
      return;
    }

    const template = node.template as ts.TemplateExpression;
    if (template.head !== undefined) {
      this.out(template.head.text);
      for (const span of template.templateSpans) {
        this.out('{');
        this.checkExpression(span.expression, f);
        this.out('}');
        this.out(span.literal.text);
      }
    } else {
      this.out((template as any).text);
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

  // getTypeOf(node: ts.Node) {
  //
  // }

  checkExpression(node: ts.Expression, f: ts.FunctionLikeDeclarationBase) {
    switch (node.kind) {
      case ts.SyntaxKind.Identifier: {
        const declaration = this.getIdentifierDeclaration(
          node as ts.Identifier
        );
        if (
          declaration !== undefined &&
          declaration.kind === ts.SyntaxKind.Parameter
        ) {
          // TODO: test this check
          if ((declaration as ts.ParameterDeclaration).parent !== f) {
            this.report(node, 'identifier references non-local parameter');
            return;
          }
          this.out(`$${node.getText()}`);
        }
        return;
      }
      case ts.SyntaxKind.StringLiteral:
        this.out(node.getFullText());
        break;
      case ts.SyntaxKind.CallExpression: {
        const call = node as ts.CallExpression;
        const func = call.expression;
        const funcSymbol = this.checker.getSymbolAtLocation(func);

        if (funcSymbol === this._stringIncludesSymbol) {
          if (!ts.isPropertyAccessExpression(func)) {
            this.report(call, 'String#includes must be called as a method');
            return;
          }
          const receiver = func.expression;
          const args = call.arguments;
          if (args.length !== 1) {
            this.report(
              call,
              'only one argument is allowed to String#includes()'
            );
            return;
          }
          const arg = args[0];
          this.out('strContains(');
          this.checkExpression(receiver, f);
          this.out(', ');
          this.checkExpression(arg, f);
          this.out(')');
          return;
        }

        if (!ts.isIdentifier(call.expression)) {
          this.report(node, 'only template functions can be called');
          return;
        }
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
            this.out(`call .${call.expression.getText()}`);
          }
        }
        this.report(node, `unknown identifier: ${node.getText()}`);
        return;
      }
      case ts.SyntaxKind.BinaryExpression: {
        const operator = (node as ts.BinaryExpression).operatorToken;
        this.checkExpression((node as ts.BinaryExpression).left, f);
        switch (operator.kind) {
          case ts.SyntaxKind.AmpersandAmpersandToken:
            this.out(' and ');
            break;
          case ts.SyntaxKind.BarBarToken:
            this.out(' or ');
            break;
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
            this.out(operator.getText());
            break;
          case ts.SyntaxKind.EqualsEqualsEqualsToken:
            this.report(operator, '=== is disallowed. Use ==');
            break;
          case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            this.report(operator, '!== is disallowed. Use !=');
            break;
        }
        this.checkExpression((node as ts.BinaryExpression).right, f);
        break;
      }
      // case ts.SyntaxKind.PrefixUnaryExpression:
      //   // TODO
      //   break;
      case ts.SyntaxKind.PropertyAccessExpression: {
        this.checkPropertyAccessExpression(
          node as ts.PropertyAccessExpression,
          f
        );
        break;
      }
      default:
        this.report(node, `unsuported expression: ${node.getText()}`);
        return;
    }
  }

  checkPropertyAccessExpression(
    node: ts.PropertyAccessExpression,
    f: ts.FunctionLikeDeclarationBase
  ) {
    const receiver = (node as ts.PropertyAccessExpression).expression;
    const receiverType = this.checker.getTypeAtLocation(receiver);

    if (receiverType === undefined) {
      return;
    }
    const name = (node as ts.PropertyAccessExpression).name.getText();

    if (isAssignableToType(stringType, receiverType, this.checker)) {
      if (name === 'length') {
        this.out('strLen(');
        this.checkExpression(receiver, f);
        this.out(')');
        return;
      }
    }
    if (isAssignableToType(arrayType, receiverType, this.checker)) {
      if (name === 'length') {
        this.out('length(');
        this.checkExpression(receiver, f);
        this.out(')');
        return;
      }
    }
    this.checkExpression(receiver, f);
    this.out(`.${name}`);
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

  out(s: string) {
    this.buffer.push(s);
  }

  get output() {
    return this.buffer.join('').trim();
  }
}

export const checkProgram = (fileNames: string[]) => {
  const program = ts.createProgram(fileNames, {
    target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.ESNext,
  });
  const checker = program.getTypeChecker();
  for (const fileName of fileNames) {
    const sourceFile = program.getSourceFile(fileName)!;
    console.log(`\nINPUT: ${sourceFile.fileName}`);
    console.log(sourceFile.getFullText());
    const converter = new SourceFileConverter(sourceFile, checker, __dirname);
    converter.checkFile();
    console.log(`\nOUTPUT`);
    console.log(converter.buffer.join(''));
  }
};

export const main = () => {
  const fileNames = process.argv.slice(2);
  checkProgram(fileNames);
};
// main();
