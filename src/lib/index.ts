import ts from "typescript";

const litTemplateDeclarations = new Map<ts.VariableDeclaration, ts.ArrowFunction>();

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

const getRenderMethod = (node: ts.ClassDeclaration, _sourceFile: ts.SourceFile, _checker: ts.TypeChecker): ts.MethodDeclaration | undefined => {
  return node.members.find((m) => ts.isMethodDeclaration(m) && m.name.getText() === 'render') as ts.MethodDeclaration;
};

const checkLitElement = (node: ts.ClassDeclaration, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  // get render method
  const render = getRenderMethod(node, sourceFile, checker);
  if (render === undefined) {
    report(node, sourceFile, 'no render method found');
    return;
  }
  checkRenderMethod(render!, sourceFile, checker);
};

const checkRenderMethod = (node: ts.MethodDeclaration, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  out(`\n{template .${(node.parent as ts.ClassDeclaration).name!.getText()}}\n`);

  const statements = node.body!.statements;
  if (statements.length !== 1) {
    report(node.body!, sourceFile, 'we only support a single return statement');
  }
  const statement1 = statements[0];
  if (ts.isReturnStatement(statement1)) {
    const expression = statement1.expression;
    if (expression!.kind !== ts.SyntaxKind.TaggedTemplateExpression) {
      report(node, sourceFile, 'litTemplates must directly return a TemplateResult');
    }  
    checkLitTemplateExpression(expression as ts.TaggedTemplateExpression, sourceFile, checker);
  }

  out(`\n{/template}\n`);
};

const checkLitTemplateFunctionDeclaration = (node: ts.VariableStatement, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  for (const declaration of node.declarationList.declarations) {
    if (declaration.initializer !== undefined && isLitTemplateFunction(declaration.initializer)) {
      checkLitTemplateFunction(declaration.initializer, sourceFile, checker);
    }
  }
}

const checkLitTemplateFunction = (node: ts.ArrowFunction, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {

  const declaration = getVariableDeclaration(node);
  if (declaration !== undefined) {
    litTemplateDeclarations.set(declaration, node);
  } else {
    report(node, sourceFile, 'no declaration found');
  }

  out(`\n{template .${(node.parent as ts.VariableDeclaration).name.getText()}}\n`);
  // TODO: check parameters
  for (const param of node.parameters) {
    out(`  {@param ${param.name.getText()}: ${param.type!.getText()}}`);
  }

  // TODO: check type parameters?
  node.typeParameters;

  // check body
  checkLitTemplateBody(node.body, sourceFile, checker);
  out(`\n{/template}\n`);
};

const checkLitTemplateBody = (node: ts.ConciseBody, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  if (node.kind !== ts.SyntaxKind.TaggedTemplateExpression) {
    report(node, sourceFile, 'litTemplates must directly return a TemplateResult');
  }
  checkLitTemplateExpression(node as ts.TaggedTemplateExpression, sourceFile, checker);
};

const checkLitTemplateExpression = (node: ts.TaggedTemplateExpression, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  // TODO: validate html tag
  node.tag;

  const template = node.template as ts.TemplateExpression;
  if (template.head !== undefined) {
    out(template.head.text);
    for (const span of template.templateSpans) {
      out('{');
      checkExpression(span.expression, sourceFile, checker);
      out('}');
      out(span.literal.text);
    }
  } else {
    // console.log('BBB', ts.SyntaxKind[template.kind]);
    out((template as any).text);
  }
};

let level = 0;
const checkExpression = (node: ts.Expression, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  console.log('*' + ' '.repeat(level) + ts.SyntaxKind[node.kind]);
  switch (node.kind) {
    case ts.SyntaxKind.Identifier:
      const symbol = checker.getSymbolAtLocation(node)!;
      const declarations = symbol.getDeclarations();
      // console.log(declarations);
      if (declarations === undefined) {
        report(node, sourceFile, 'no declarations');
      } else {
        for (const declaration of declarations) {
          if (declaration.kind === ts.SyntaxKind.Parameter) {
            // TODO: check that it's a local declaration, not a free variable...
            // ok
            out(`$${node.getFullText()}`);
          } else if (declaration.kind === ts.SyntaxKind.VariableDeclaration) {
            // TODO: this is in the wrong place, we should only do this if we know
            // we're in a call expression
            const litTemplate = litTemplateDeclarations.get(declaration as ts.VariableDeclaration);
            if (litTemplate !== undefined) {
              out(`call .${(declaration as ts.VariableDeclaration).name.getText()}`);
            } else {
              report(node, sourceFile, 'unknown identifier');
            }
          }
        }
      }
      // console.log(`symbol for ${node.getFullText()}`, symbol);
      // const type = checker.getContextualType(node);
      // console.log(`identifier type for ${node.getFullText()}`, type);
      // out(`$${node.getFullText()}`);
      break;
    case ts.SyntaxKind.PlusToken:
    case ts.SyntaxKind.MinusToken:
    case ts.SyntaxKind.AsteriskToken:
    case ts.SyntaxKind.SlashToken:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.StringLiteral:
      out(node.getFullText());
      break;
    case ts.SyntaxKind.AmpersandAmpersandToken:
      out(' and ');
      break;
    case ts.SyntaxKind.ExclamationToken:
      out(' not ');
      break;
    case ts.SyntaxKind.CallExpression:
      // TODO: call into a CallExpression handler with logic from above
      // Identifier logic
    case ts.SyntaxKind.BinaryExpression:
    case ts.SyntaxKind.PrefixUnaryExpression:
      // continue
      break;
    default:
      report(node, sourceFile, `unsupoorted expression: ${node.getText()}`);
      return;
      break;
  }
  level++;
  ts.forEachChild(node, (c) => checkExpression(c as any, sourceFile, checker));
  level--;
};

const checkNode = (node: ts.Node, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  if (isLitTemplateFunctionDeclaration(node)) {
    checkLitTemplateFunctionDeclaration(node, sourceFile, checker);
  } else {
    ts.forEachChild(node, (n) => checkNode(n, sourceFile, checker));
  }
}

const pathToNamespace = (path: string) => path.replace(/\//g, '.');

const checkFile = (node: ts.Node, sourceFile: ts.SourceFile, checker: ts.TypeChecker) => {
  out(`{namespace ${pathToNamespace(sourceFile.fileName)}}\n`);

  ts.forEachChild(node, (node) => {
    console.log(ts.SyntaxKind[node.kind]);
    if (isLitTemplateFunctionDeclaration(node)) {
      checkLitTemplateFunctionDeclaration(node, sourceFile, checker);
    } else if (isLitElement(node)) {
      checkLitElement(node, sourceFile, checker);
    }
  });

}

const report = (node: ts.Node, sourceFile: ts.SourceFile, message: string) => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart()
  );
  console.log(
    `${sourceFile.fileName} (${line + 1},${character + 1}): ${message}`
  );
}


const buffer: string[] = [];
const out = (s: string) => {
  buffer.push(s);
}

const fileNames = process.argv.slice(2);
const program = ts.createProgram(fileNames, {
  target: ts.ScriptTarget.ES2017,
  module: ts.ModuleKind.ESNext,
});
const checker = program.getTypeChecker();

for (const fileName of fileNames) {
  const sourceFile = program.getSourceFile(fileName)!;
  console.log(`\nINPUT: ${sourceFile.fileName}`);
  console.log(sourceFile.getFullText());
  checkFile(sourceFile, sourceFile, checker);
}
console.log('\nOUTPUT');
console.log(buffer.join(''));
