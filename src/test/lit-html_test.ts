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
import {convertModule, js, soy} from './test-utils.js';

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

      test('text ternary', () => {
        const result = convertModule(
          'test.ts',
          js`
        import {html} from 'lit-html';

        /**
         * @soyCompatible
         */
        export const t = (yes: boolean) => html\`
          <div>\${yes
            ? html\`<p>yes</p>\`
            : html\`<p>no</p>\`
          }</div>\`;
      `
        );
        assert.equal(
          result.output,
          soy`
          {namespace test.ts}

          {template .t}
            {@param yes: bool}
          
            <div>{if $yes}<p>yes</p>{else}<p>no</p>{/if}</div>
          {/template}
        `
        );
      });

      test('expression ternary', () => {
        const result = convertModule(
          'test.ts',
          js`
        import {html} from 'lit-html';

        /**
         * @soyCompatible
         */
        export const t = (yes: boolean) => html\`
          <div>\${1 + (yes ? 1 : 2)}</div>\`;
      `
        );
        assert.equal(
          result.output,
          soy`
          {namespace test.ts}

          {template .t}
            {@param yes: bool}
          
            <div>{1+($yes?1:2)}</div>
          {/template}
        `
        );
      });

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

      test('String.includes()', () => {
        const result = convertModule(
          'test.ts',
          js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string) => html\`\${a.includes('a')}\`;
        `
        );
        assert.equal(
          result.output,
          soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
          {strContains($a, 'a')}
          {/template}
        `
        );
        assert.equal(result.diagnostics.length, 0);
      });
    });
  });
});
