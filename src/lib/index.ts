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

class TestLanguageServiceHost implements ts.LanguageServiceHost {
  files: Map<string, {version: number; source: string}>;

  constructor() {
    this.files = new Map();
  }

  getCompilationSettings(): ts.CompilerOptions {
    return compilerOptions;
  }

  getScriptFileNames(): string[] {
    return Array.from(this.files.keys());
  }

  getScriptVersion(fileName: string) {
    const file = this.files.get(fileName);
    return (file === undefined ? -1 : file.version).toString();
  }

  fileExists(fileName: string): boolean {
    if (this.files.has(fileName)) {
      return true;
    }
    if (!fileName.startsWith(packageRoot)) {
      return false;
    }
    try {
      fs.statSync(fileName);
      return true;
    } catch (e) {
      return false;
    }
  }

  readFile(fileName: string): string | undefined {
    if (this.files.has(fileName)) {
      return this.files.get(fileName)!.source;
    }
    let contents = fileCache.get(fileName);
    if (contents !== undefined) {
      return contents;
    }
    contents = fs.readFileSync(fileName, 'utf-8');
    fileCache.set(fileName, contents);
    return contents;
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    if (!this.fileExists(fileName)) {
      return undefined;
    }
    return ts.ScriptSnapshot.fromString(this.readFile(fileName)!);
  }

  getCurrentDirectory(): string {
    return __dirname;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }
}

const compilerOptions = {
  target: ts.ScriptTarget.ES2017,
  module: ts.ModuleKind.ESNext,
  experimentalDecorators: true,
  skipDefaultLibCheck: true,
  skipLibCheck: true,
};

const languageServiceHost = new TestLanguageServiceHost();
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

const fileCache = new Map<string, string>();
