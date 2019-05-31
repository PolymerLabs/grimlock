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
import stripIndent = require('strip-indent');

suite('grimlock', () => {

  suite('lit-html', () => {

    test('simple template', () => {
      assert.equal(convertModule('test.ts', js`
        import {html} from 'lit-html';

        /**
         * @soyCompatible
         */
        export const t = () => html\`<div></div>\`;
      `), soy`
        {namespace test.ts}

        {template .t}
        <div></div>
        {/template}
      `);
    });

    test('parameters and expression', () => {
      assert.equal(convertModule('test.ts', js`
        import {html} from 'lit-html';

        /**
         * @soyCompatible
         */
        export const t = (a: string, b: number, c: boolean) => 
            html\`<div>\${a}\${b}\${c}</div>\`;
      `), soy`
        {namespace test.ts}

        {template .t}
          {@param a: string}
          {@param b: number}
          {@param c: bool}
        <div>{$a}{$b}{$c}</div>
        {/template}
      `);
    });

    test('subtemplate call', () => {
      assert.equal(convertModule('test.ts', js`
        import {html} from 'lit-html';

        /**
         * @soyCompatible
         */
        export const t2 = () => html\`<div>\${t2()}</div>\`;

        /**
         * @soyCompatible
         */
        export const t1 = () => html\`<div></div>\`;
      `), soy`
        {namespace test.ts}

        {template .t2}
        <div>{call .t2}</div>
        {/template}

        {template .t1}
        <div></div>
        {/template}
      `);
    });

  });

});


const convertModule = (fileName: string, source: string) => {
  const host = new TestHost({
    [fileName]: source,
  });
  const program = ts.createProgram([fileName], {
    target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.ESNext,
  }, host);
  const checker = program.getTypeChecker();    
  const sourceFile = program.getSourceFile(fileName)!;
  const converter = new SourceFileConverter(sourceFile, checker);
  converter.checkFile();
  return converter.buffer.join('').trim();
};

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

const stripIndentTag = (strings: TemplateStringsArray, ..._values: any[]) => {
  return stripIndent(strings[0]).trim();
};
const js = stripIndentTag;
const soy = stripIndentTag;
