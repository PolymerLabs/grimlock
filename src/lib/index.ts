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

import {SourceFileConverter} from './source-file-converter.js';
import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import {stripIndentTag} from '../lib/utils.js';
import {OverlayLanguageServiceHost} from './overlay-language-service-host.js';

const {WritableStream} = require('memory-streams');

/**
 * Remove indentation from a template literal containing JavaScript.
 */
export const js = stripIndentTag(true);

/**
 * Remove indentation from a template literal containing Soy.
 */
export const soy = stripIndentTag(true);

const packageRoot = path.resolve(__dirname, '../');

const compilerOptions = {
  target: ts.ScriptTarget.ES2017,
  module: ts.ModuleKind.ESNext,
  experimentalDecorators: true,
  skipDefaultLibCheck: true,
  skipLibCheck: true,
};

const languageServiceHost = new OverlayLanguageServiceHost(
  packageRoot,
  compilerOptions
);

const services = ts.createLanguageService(
  languageServiceHost,
  ts.createDocumentRegistry()
);

export const convertModule = (
  fileName: string,
  source: string,
  definedElements?: {[tagName: string]: string}
) => {
  const testPath = path.resolve(__dirname, fileName);
  const existingFile = languageServiceHost.files.get(testPath);
  const version = existingFile === undefined ? 0 : existingFile.version + 1;
  languageServiceHost.files.clear();
  languageServiceHost.files.set(testPath, {version, source});

  const program = services.getProgram()!;
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(testPath)!;

  const diagnostics = program.getSyntacticDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    console.error(
      diagnostics.map((d) => `${d.file.fileName}: ${d.messageText}`)
    );
    throw new Error('syntax errors in test input');
  }

  const definedElementsMap =
    definedElements && new Map(Object.entries(definedElements));
  const converter = new SourceFileConverter(
    sourceFile,
    checker,
    __dirname,
    definedElementsMap
  );
  const ast = converter.convertFile();

  return {
    ast,
    get output() {
      const writer = new WritableStream();
      ast.emit(writer);
      return writer.toString().trim();
    },
    diagnostics: converter.diagnostics,
    converter,
  };
};

const checkProgram = (input: string, output: string) => {
  const result = convertModule(input, fs.readFileSync(input, 'utf8')).output;
  fs.writeFileSync(output, result, 'utf8');
};

const main = () => {
  const [inFile, outFile] = process.argv.slice(2);
  if (
    inFile === undefined ||
    !inFile.endsWith('.ts') ||
    outFile === undefined ||
    !outFile.endsWith('.soy')
  ) {
    console.error(`Usage: grimlock input.ts output.soy`);
    process.exitCode = 1;
    return;
  }
  checkProgram(inFile, outFile);
};

if (require.main === module) {
  main();
}
