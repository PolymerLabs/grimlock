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

import {SourceFileConverter} from '../lib/index.js';
import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import {stripIndentTag} from '../lib/utils.js';

export const js = stripIndentTag(true);
export const soy = stripIndentTag(true);

const packageRoot = path.resolve(__dirname, '../');

export const convertModule = (fileName: string, source: string) => {
  const testPath = path.resolve(__dirname, fileName);
  const host = new TestHost({
    [testPath]: source,
  });
  const program = ts.createProgram(
    [testPath],
    {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
      experimentalDecorators: true,
      skipDefaultLibCheck: true,
      skipLibCheck: true,
    },
    host
  );
  const checker = program.getTypeChecker();

  const sourceFile = program.getSourceFile(testPath)!;
  // TODO: assert 0 diagnostics for most tests
  // const diagnostics = program.getSemanticDiagnostics(sourceFile);
  // if (diagnostics.length > 0) {
  //   console.log(diagnostics.map((d) => `${d.file}: ${d.messageText}`));
  // }
  const converter = new SourceFileConverter(sourceFile, checker, __dirname);
  converter.checkFile();
  return converter;
};

const fileCache = new Map<string, string>();

class TestHost implements ts.CompilerHost {
  files: Map<string, string>;

  constructor(files: {[fileName: string]: string}) {
    this.files = new Map(Object.entries(files));
  }

  resolveModuleNames(
    moduleNames: string[],
    containingFile: string
  ): (ts.ResolvedModule | undefined)[] {
    const resolvedModules = moduleNames.map(
      (moduleName) =>
        ts.resolveModuleName(
          moduleName,
          containingFile,
          {},
          {
            fileExists: (n) => this.fileExists(n),
            readFile: (n) => this.readFile(n),
          }
        ).resolvedModule
    );
    return resolvedModules;
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
      return this.files.get(fileName);
    }
    let contents = fileCache.get(fileName);
    if (contents !== undefined) {
      return contents;
    }
    contents = fs.readFileSync(fileName, 'utf-8');
    fileCache.set(fileName, contents);
    return contents;
  }

  getSourceFile(
    fileName: string,
    _languageVersion: ts.ScriptTarget,
    onError?: (message: string) => void,
    _shouldCreateNewSourceFile?: boolean
  ): ts.SourceFile | undefined {
    if (this.fileExists(fileName)) {
      return ts.createSourceFile(
        fileName,
        this.readFile(fileName)!,
        ts.ScriptTarget.ES2017,
        true
      );
    } else if (onError !== undefined) {
      onError(`File not found ${fileName}`);
    }
    return undefined;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  writeFile: ts.WriteFileCallback = undefined as any;

  getCurrentDirectory(): string {
    return '/';
  }

  getCanonicalFileName(fileName: string): string {
    return fileName;
  }

  useCaseSensitiveFileNames(): boolean {
    return true;
  }

  getNewLine(): string {
    return '\n';
  }
}
