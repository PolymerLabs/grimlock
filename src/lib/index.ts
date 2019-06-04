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
import { isAssignableToType, SimpleType, SimpleTypeKind } from "ts-simple-type";

const litTemplateDeclarations = new Map<ts.VariableDeclaration, ts.ArrowFunction>();

const pathToNamespace = (path: string) => path.replace(/\//g, '.');

const isSoyCompatible = (node: ts.Node) => 
    ts.getJSDocTags(node).some((t) => t.tagName.escapedText === 'soyCompatible');

const isLitTemplateFunctionDeclaration = (node: ts.Node): node is ts.VariableStatement => {
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer !== undefined && ts.isArrowFunction(declaration.initializer) && isSoyCompatible(node)) {
        return true;
      }
    }
  }
  return false;
}

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

const getRenderMethod = (node: ts.ClassDeclaration): ts.MethodDeclaration | undefined => {
  return node.members.find((m) => ts.isMethodDeclaration(m) && m.name.getText() === 'render') as ts.MethodDeclaration;
};

const booleanType: SimpleType = {kind: SimpleTypeKind.BOOLEAN};
const numberType: SimpleType = {kind: SimpleTypeKind.NUMBER};
const stringType: SimpleType = {kind: SimpleTypeKind.STRING};
const nullishType: SimpleType = {
  kind: SimpleTypeKind.UNION,
  types: [
    {kind: SimpleTypeKind.NULL},
    {kind: SimpleTypeKind.UNDEFINED},
  ]
};

export interface Diagnostic {
  fileName: string;
  line: number;
  character: number;
  message: string;
};

export class SourceFileConverter {
  buffer: string[] = [];
  diagnostics: Diagnostic[] = [];
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;

  constructor(sourceFile: ts.SourceFile, checker: ts.TypeChecker) {
    this.sourceFile = sourceFile;
    this.checker = checker;
  }

  checkFile() {
    this.out(`{namespace ${pathToNamespace(this.sourceFile.fileName)}}\n`);

    ts.forEachChild(this.sourceFile, (node) => {
      if (isLitTemplateFunctionDeclaration(node)) {
        this.checkLitTemplateFunctionDeclaration(node);
      } else if (isLitElement(node)) {
        this.checkLitElement(node);
      }
    });
  }

  checkLitElement(node: ts.ClassDeclaration) {
    // get render method
    const render = getRenderMethod(node);
    if (render === undefined) {
      this.report(node, 'no render method found');
      return;
    }
    this.checkRenderMethod(render!);
  }

  checkRenderMethod(node: ts.MethodDeclaration) {
    this.out(`\n{template .${(node.parent as ts.ClassDeclaration).name!.getText()}}\n`);

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
      this.checkLitTemplateExpression(expression as ts.TaggedTemplateExpression);
    }

    this.out(`\n{/template}\n`);
  }

  checkLitTemplateFunctionDeclaration(node: ts.VariableStatement) {
    for (const declaration of node.declarationList.declarations) {
      if (declaration.initializer !== undefined && isLitTemplateFunction(declaration.initializer)) {
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

    this.out(`\n{template .${(node.parent as ts.VariableDeclaration).name.getText()}}\n`);
    // TODO: check parameters
    for (const param of node.parameters) {
      const type = this.soyTypeOf(param);
      const name = param.name.getText();
      if (type === undefined) {
        this.report(param, `parameters must have a declared type`);
      }
      this.out(`  {@param ${name}${type === undefined ? '' : `: ${type}`}}\n`);
    }

    // TODO: check type parameters?
    node.typeParameters;

    // check body
    this.checkLitTemplateBody(node.body);
    this.out(`\n{/template}\n`);
  }

  checkLitTemplateBody(node: ts.ConciseBody) {
    if (node.kind !== ts.SyntaxKind.TaggedTemplateExpression) {
      this.report(node, 'litTemplates must directly return a TemplateResult');
    }
    this.checkLitTemplateExpression(node as ts.TaggedTemplateExpression);
  };

  checkIsLitHtmlTag(tag: ts.Node) {
    const failMessage = 'template tags must be named imports from the modules' +
        ' "lit-html" or "lit-element"';
    if (!ts.isIdentifier(tag)) {
      this.report(tag, failMessage);
      return false;
    }
    const symbol = this.checker.getSymbolAtLocation(tag);
    if (symbol === undefined || symbol.declarations.length === 0) {
      this.report(tag, failMessage);
      return false;
    }
    const declaration = symbol.declarations[0];
    if (declaration.kind !== ts.SyntaxKind.ImportSpecifier || 
      declaration.parent.kind !== ts.SyntaxKind.NamedImports) {
        this.report(tag, failMessage);
        return false;
    }
    const aliased = this.checker.getAliasedSymbol(symbol);
    if (aliased.declarations === undefined) {
      this.report(tag, failMessage);
      return false;
    }
    const originalDeclaration = aliased.declarations[0];
    const originalDeclarationFileName = originalDeclaration.getSourceFile().fileName;
    if (!originalDeclarationFileName.endsWith('/node_modules/lit-html/lit-html.d.ts')) {
      this.report(tag, failMessage);
      return false;
    }
    return aliased.name === 'html';
  }

  checkLitTemplateExpression(node: ts.TaggedTemplateExpression) {
    if (!this.checkIsLitHtmlTag(node.tag)) {
      return;
    }

    const template = node.template as ts.TemplateExpression;
    if (template.head !== undefined) {
      this.out(template.head.text);
      for (const span of template.templateSpans) {
        this.out('{');
        this.checkExpression(span.expression);
        this.out('}');
        this.out(span.literal.text);
      }
    } else {
      // console.log('BBB', ts.SyntaxKind[template.kind]);
      this.out((template as any).text);
    }
  }

  checkExpression(node: ts.Expression) {
    switch (node.kind) {
      case ts.SyntaxKind.Identifier:
        const symbol = this.checker.getSymbolAtLocation(node)!;
        const declarations = symbol.getDeclarations();
        // console.log(declarations);
        if (declarations === undefined) {
          this.report(node, 'no declarations');
        } else {
          for (const declaration of declarations) {
            if (declaration.kind === ts.SyntaxKind.Parameter) {
              // TODO: check that it's a local declaration, not a free variable...
              // ok
              this.out(`$${node.getFullText()}`);
            } else if (declaration.kind === ts.SyntaxKind.VariableDeclaration) {
              // TODO: this is in the wrong place, we should only do this if we know
              // we're in a call expression
              const litTemplate = litTemplateDeclarations.get(declaration as ts.VariableDeclaration);
              if (litTemplate !== undefined) {
                this.out(`call .${(declaration as ts.VariableDeclaration).name.getText()}`);
              } else {
                this.report(node, 'unknown identifier');
              }
            }
          }
        }
        // console.log(`symbol for ${node.getFullText()}`, symbol);
        // const type = checker.getContextualType(node);
        // console.log(`identifier type for ${node.getFullText()}`, type);
        // this.out(`$${node.getFullText()}`);
        break;
      case ts.SyntaxKind.PlusToken:
      case ts.SyntaxKind.MinusToken:
      case ts.SyntaxKind.AsteriskToken:
      case ts.SyntaxKind.SlashToken:
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.StringLiteral:
        this.out(node.getFullText());
        break;
      case ts.SyntaxKind.AmpersandAmpersandToken:
        this.out(' and ');
        break;
      case ts.SyntaxKind.ExclamationToken:
        this.out(' not ');
        break;
      case ts.SyntaxKind.CallExpression:
        // TODO: call into a CallExpression handler with logic from above
        // Identifier logic
      case ts.SyntaxKind.BinaryExpression:
      case ts.SyntaxKind.PrefixUnaryExpression:
        // continue
        break;
      default:
        this.report(node, `unsupoorted expression: ${node.getText()}`);
        return;
        break;
    }
    ts.forEachChild(node, (c) => this.checkExpression(c as any));
  }

  checkNode(node: ts.Node) {
    if (isLitTemplateFunctionDeclaration(node)) {
      this.checkLitTemplateFunctionDeclaration(node);
    } else {
      ts.forEachChild(node, (n) => this.checkNode(n));
    }
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
  soyTypeOf(node: ts.HasType): string | undefined {
    const typeNode = node.type;
    if (typeNode === undefined) {
      return undefined;
    }
    const type = this.checker.getTypeAtLocation(typeNode);

    if (isAssignableToType(type, booleanType, this.checker)) {
      return 'bool'
    } else if (isAssignableToType(type, numberType, this.checker)) {
      return 'number';
    } else if (isAssignableToType(type, stringType, this.checker)) {
      return 'string';
    } else if (isAssignableToType(type, nullishType, this.checker)) {
      return 'null';
    }
    // generic fallback.
    // TODO: validation?
    return typeNode.getText();
  }
  
  report(node: ts.Node, message: string) {
    const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(
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
    const converter = new SourceFileConverter(sourceFile, checker);
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
