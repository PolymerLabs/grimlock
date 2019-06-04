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

const stripIndentTag = (strings: TemplateStringsArray, ...values: any[]) => {
  const result = values.reduce(
    (acc, v, i) => acc + String(v) + strings[i + 1],
    strings[0]
  );
  return stripIndent(result).trim();
};
const js = stripIndentTag;
const soy = stripIndentTag;

suite('grimlock', () => {
  suite('lit-html', () => {
    suite('template function declaration', () => {
      test('simple declaration', () => {
        assert.equal(
          convertModule(
            'test.ts',
            js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = () => html\`<div></div>\`;
        `
          ).output,
          soy`
          {namespace test.ts}

          {template .t}
          <div></div>
          {/template}
        `
        );
      });

      test('missing @soyCompatible', () => {
        // Documenting current behavior. Perhaps we shold error with
        // "nothing to translate"
        assert.equal(
          convertModule(
            'test.ts',
            js`
          import {html} from 'lit-html';
        `
          ).output,
          soy`
          {namespace test.ts}
        `
        );
      });

      test('incorrect html tag', () => {
        const result = convertModule(
          'test.ts',
          js`
          /**
           * @soyCompatible
           */
          export const t = () => html\`<div></div>\`;
          `
        );
        assert.equal(result.diagnostics.length, 1);
        assert.include(
          result.diagnostics[0].message,
          'template tags must be named imports'
        );
      });

      test('parameters and expression', () => {
        assert.equal(
          convertModule(
            'test.ts',
            js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string, b: number, c: boolean) => 
              html\`<div>\${a}\${b}\${c}</div>\`;
        `
          ).output,
          soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
            {@param b: number}
            {@param c: bool}
          <div>{$a}{$b}{$c}</div>
          {/template}
        `
        );
      });

      test('error on unsupported statements', () => {
        const result = convertModule(
          'test.ts',
          js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string) => {
            /**
             * @soyCompatible
             */
            const inner = () => html\`\${a}\`;
          };
        `
        );
        assert.equal(result.diagnostics.length, 2);
        assert.include(result.diagnostics[0].message, 'unsupported statement');
        assert.include(
          result.diagnostics[1].message,
          'must return a TemplateResult'
        );
      });
    });

    suite('expressions', () => {
      test('subtemplate call', () => {
        assert.equal(
          convertModule(
            'test.ts',
            js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t2 = () => html\`<div>\${t2()}</div>\`;

          /**
           * @soyCompatible
           */
          export const t1 = () => html\`<div></div>\`;
        `
          ).output,
          soy`
          {namespace test.ts}

          {template .t2}
          <div>{call .t2}</div>
          {/template}

          {template .t1}
          <div></div>
          {/template}
        `
        );
      });

      test('error on unknown reference', () => {
        const result = convertModule(
          'test.ts',
          js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = () => html\`\${a}\`;
        `
        );
        assert.equal(result.diagnostics.length, 1);
        assert.include(result.diagnostics[0].message, 'unknown identifier');
      });

      test('references to parameters', () => {
        const result = convertModule(
          'test.ts',
          js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string) => html\`\${a}\`;
        `
        );
        assert.equal(
          result.output,
          soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
          {$a}
          {/template}
        `
        );
        assert.equal(result.diagnostics.length, 0);
      });

      const binaryOps = [
        '+',
        '-',
        '*',
        '/',
        '%',
        '<',
        '>',
        '>=',
        '<=',
        ['||', ' or '],
        ['&&', ' and '],
      ];
      for (let op of binaryOps) {
        let expected = op;
        if (Array.isArray(op)) {
          expected = op[1];
          op = op[0];
        }
        test(`binary ${op} operator`, () => {
          const result = convertModule(
            'test.ts',
            js`
            import {html} from 'lit-html';

            /**
             * @soyCompatible
             */
            export const t = (a: string, b: string) => html\`\${a ${op} b}\`;
          `
          );
          assert.equal(
            result.output,
            soy`
            {namespace test.ts}

            {template .t}
              {@param a: string}
              {@param b: string}
            {$a${expected}$b}
            {/template}
          `
          );
          assert.equal(result.diagnostics.length, 0);
        });
      }

      test(`error on strict equality`, () => {
        const result = convertModule(
          'test.ts',
          js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string, b: string) => html\`\${a === b}\${a !== b}\`;
        `
        );
        assert.equal(result.diagnostics.length, 2);
        assert.include(result.diagnostics[0].message, '=== is disallowed');
        assert.include(result.diagnostics[1].message, '!== is disallowed');
      });

      test('Array.length', () => {
        const result = convertModule(
          'test.ts',
          js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string[]) => html\`\${a.length}\`;
        `
        );
        assert.equal(
          result.output,
          soy`
          {namespace test.ts}

          {template .t}
            {@param a: list<string>}
          {length($a)}
          {/template}
        `
        );
        assert.equal(result.diagnostics.length, 0);
      });

      test('String.length', () => {
        const result = convertModule(
          'test.ts',
          js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string) => html\`\${a.length}\`;
        `
        );
        assert.equal(
          result.output,
          soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
          {strLen($a)}
          {/template}
        `
        );
        assert.equal(result.diagnostics.length, 0);
      });
    });
  });
});

const convertModule = (fileName: string, source: string) => {
  const host = new TestHost({
    [fileName]: source,
  });
  const program = ts.createProgram(
    [fileName],
    {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
      skipDefaultLibCheck: true,
      skipLibCheck: true,
    },
    host
  );
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(fileName)!;
  // TODO: assert 0 diagnostics for most tests
  // const diagnostics = program.getSemanticDiagnostics(sourceFile);
  // console.log(diagnostics.length);
  const converter = new SourceFileConverter(sourceFile, checker);
  converter.checkFile();
  return converter;
};

const packageRoot = path.resolve(__dirname, '../');

const fileCache = new Map<string, string>();

class TestHost implements ts.CompilerHost {
  files: Map<string, string>;

  constructor(files: {[fileName: string]: string}) {
    this.files = new Map(Object.entries(files));
  }

  resolveModuleNames(
    moduleNames: string[],
    _containingFile: string
  ): (ts.ResolvedModule | undefined)[] {
    const resolvedNames = moduleNames.map((n) => {
      if (n === 'lit-html') {
        const resolvedFileName = path.resolve(
          packageRoot,
          'node_modules/lit-html/lit-html.d.ts'
        );
        return {
          resolvedFileName,
          isExternalLibraryImport: false,
        };
      }
      return undefined;
    });
    return resolvedNames;
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
    if (fileName.startsWith(packageRoot)) {
      let contents = fileCache.get(fileName);
      if (contents !== undefined) {
        return contents;
      }
      contents = fs.readFileSync(fileName, 'utf-8');
      fileCache.set(fileName, contents);
      return contents;
    }
    return this.files.get(fileName);
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
