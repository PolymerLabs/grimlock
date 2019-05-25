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

import {assert} from 'chai';
import {SourceFileConverter} from '../lib/index.js';
import ts from 'typescript';

suite('grimlock', () => {

  suite('lit-html', () => {

    test('simple template', () => {

      const host = new TestHost({
        'test.ts': `
          import {html} from 'lit-html';

          export const t = () => html\`<div></div>\`;
        `
      });

      const program = ts.createProgram(['test.ts'], {
        target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.ESNext,
      }, host);
      const checker = program.getTypeChecker();    
      const sourceFile = program.getSourceFile('test.ts')!;
      const converter = new SourceFileConverter(sourceFile, checker);
      converter.checkFile();
      assert.equal(converter.buffer.join(''), `{namespace test.ts}\n`);
    });

  });

});

class TestHost implements ts.CompilerHost {
  files: Map<string, string>;

  constructor(files: {[fileName: string]: string}) {
    this.files = new Map(Object.entries(files));
  }

  fileExists(fileName: string): boolean {
    return this.files.has(fileName);
  }

  readFile(fileName: string): string | undefined {
    return this.files.get(fileName);
  }

  getSourceFile(fileName: string, _languageVersion: ts.ScriptTarget, onError?: (message: string) => void, _shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined {
    if (this.fileExists(fileName)) {
      return ts.createSourceFile(fileName, this.readFile(fileName)!, ts.ScriptTarget.ES2017, true);
    } else if (onError !== undefined) {
      onError(`File not found ${fileName}`);
    }
    return undefined;
  }

  getDefaultLibFileName(_options: ts.CompilerOptions): string {
    return '';
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
