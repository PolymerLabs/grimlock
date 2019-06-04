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
import * as path from 'path';
import * as fs from 'fs';

const stripIndentTag = (strings: TemplateStringsArray, ..._values: any[]) => {
  return stripIndent(strings[0]).trim();
};
const js = stripIndentTag;
const soy = stripIndentTag;

suite('grimlock', () => {

  suite('lit-html', () => {

    suite('template function declaration', () => {

      test('simple declaration', () => {
        assert.equal(convertModule('test.ts', js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = () => html\`<div></div>\`;
        `).output, soy`
          {namespace test.ts}

          {template .t}
          <div></div>
          {/template}
        `);
      });

      test('missing @soyCompatible', () => {
        // Documenting current behavior. Perhaps we shold error with
        // "nothing to translate"
        assert.equal(convertModule('test.ts', js`
          import {html} from 'lit-html';
        `).output, soy`
          {namespace test.ts}
        `);
      });

      test('incorrect html tag', () => {
        const result = convertModule('test.ts', js`
          /**
           * @soyCompatible
           */
          export const t = () => html\`<div></div>\`;
          `);
        assert.equal(result.diagnostics.length, 1);
        assert.include(result.diagnostics[0].message, 'template tags must be named imports');
      });

      test('parameters and expression', () => {
        assert.equal(convertModule('test.ts', js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string, b: number, c: boolean) => 
              html\`<div>\${a}\${b}\${c}</div>\`;
        `).output, soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
            {@param b: number}
            {@param c: bool}
          <div>{$a}{$b}{$c}</div>
          {/template}
        `);
      });

    });

    suite('expressions', () => {

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
        `).output, soy`
          {namespace test.ts}

          {template .t2}
          <div>{call .t2}</div>
          {/template}

          {template .t1}
          <div></div>
          {/template}
        `);
      });

      test('unknown reference', () => {
        const result = convertModule('test.ts', js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = () => html\`\${a}\`;
        `);
        assert.equal(result.diagnostics.length, 1);
        assert.include(result.diagnostics[0].message, 'unknown identifier');
      });

      test('references to parameters', () => {
        const result = convertModule('test.ts', js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string) => html\`\${a}\`;
        `);
        assert.equal(result.output, soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
          {$a}
          {/template}
        `);
        assert.equal(result.diagnostics.length, 0);
      });

      test('binary + operator on strings', () => {
        const result = convertModule('test.ts', js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string, b: string) => html\`\${a + b}\`;
        `);
        assert.equal(result.output, soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
            {@param b: string}
          {$a+$b}
          {/template}
        `);
        assert.equal(result.diagnostics.length, 0);
      });
      
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
  return converter;
};

const litHtmlRoot = path.resolve(__dirname, '../node_modules/lit-html/');

class TestHost implements ts.CompilerHost {
  files: Map<string, string>;

  constructor(files: {[fileName: string]: string}) {
    this.files = new Map(Object.entries(files));
  }

  resolveModuleNames(moduleNames: string[], _containingFile: string): (ts.ResolvedModule | undefined)[] {
    const resolvedNames = moduleNames.map((n) => {
      if (n === 'lit-html') {
        const resolvedFileName = path.resolve(__dirname, '../node_modules/lit-html/lit-html.d.ts');
        return {
          resolvedFileName,
          isExternalLibraryImport: false,
        };
      };
      return undefined;
    });
    return resolvedNames;
  }

  fileExists(fileName: string): boolean {
    return this.files.has(fileName) || fileName.startsWith(litHtmlRoot);
  }

  readFile(fileName: string): string | undefined {
    if (fileName.startsWith(litHtmlRoot)) {
      return fs.readFileSync(fileName, 'utf-8');
    }
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
