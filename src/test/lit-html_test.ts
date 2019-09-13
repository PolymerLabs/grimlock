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

import 'jasmine';

import {convertModule, js, soy} from '../lib/index.js';

describe('grimlock', () => {
  describe('lit-html', () => {
    describe('template function declaration', () => {
      it('simple declaration', () => {
        expect(
          convertModule(
            'test.ts',
            js`
                import {html} from 'lit-html';

                /**
                 * @soyCompatible
                 */
                export const t = () => html\`<div></div>\`;
                        `
          ).output
        ).toEqual(soy`
                {namespace test.ts}

                {template .t}
                <div></div>
                {/template}
              `);
      });

      it('missing @soyCompatible', () => {
        // Documenting current behavior. Perhaps we shold error with
        // "nothing to translate"
        expect(
          convertModule(
            'test.ts',
            js`
                import {html} from 'lit-html';
              `
          ).output
        ).toEqual(soy`
                {namespace test.ts}
              `);
      });

      it('incorrect html tag', () => {
        const result = convertModule(
          'test.ts',
          js`
          /**
           * @soyCompatible
           */
          export const t = () => html\`<div></div>\`;
          `
        );
        expect(result.diagnostics.length).toEqual(1);
        expect(result.diagnostics[0].message).toContain(
          'must return a TemplateResult'
        );
      });

      it('parameters and text expression', () => {
        expect(
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
          ).output
        ).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
            {@param b: number}
            {@param c: bool}
          <div>{$a}{$b}{$c}</div>
          {/template}
        `);
      });

      it('parameters and attribute expression', () => {
        expect(
          convertModule(
            'test.ts',
            js`
          import {html} from 'lit-html';

          /**
           * @soyCompatible
           */
          export const t = (a: string, b: number, c: boolean) => 
              html\`<div class=\${a} .foo=\${b}>\${c}</div>\`;
        `
          ).output
        ).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
            {@param b: number}
            {@param c: bool}
          <div class="{$a}">{$c}</div>
          {/template}
        `);
      });

      // TODO: add test cases for
      // - `class` and `.className` on same element
      // - input with `.value` and `.checked`
      // - `.id`, `.tabIndex`, etc.
      // - event bindings such as `.onclick`
      it('reflecting property expressions', () => {
        expect(
          convertModule(
            'test.ts',
            js`
                import {html} from 'lit-html';

                /**
                 * @soyCompatible
                 */
                export const t = () => {
                  return html\`<input .value=\${"foo"} .className=\${"bar"}>\`
                };
              `
          ).output
        ).toEqual(soy`
                {namespace test.ts}

                {template .t}
                <input value="{"foo"}" class="{"bar"}">
                {/template}
              `);
      });

      it('error on unsupported statements', () => {
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
            function f() {}
          };
        `
        );
        expect(result.diagnostics.length).toEqual(2);
        expect(result.diagnostics[0].message).toContain(
          'unsupported statement'
        );
        expect(result.diagnostics[1].message).toContain(
          'must return a TemplateResult'
        );
      });

      // TODO: add tests for keeping unclosed/closed tags.
      // E.g., an input of <div> should output <div>, not <div></div>.
    });

    describe('expressions', () => {
      it('subtemplate call', () => {
        expect(
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
          ).output
        ).toEqual(soy`
          {namespace test.ts}

          {template .t2}
          <div>{call .t2 /}</div>
          {/template}

          {template .t1}
          <div></div>
          {/template}
        `);
      });

      it('error on unknown reference', () => {
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
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics[0].message).toContain('unknown identifier');
        expect(() => {
          // tslint:disable-next-line:no-unused-expression Check for throw
          result.output;
        }).toThrow();
      });

      it('references to parameters', () => {
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
        expect(result.output).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
          {$a}
          {/template}
        `);
        expect(result.diagnostics.length).toEqual(0);
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
        ['||', 'or'],
        ['&&', 'and'],
      ];
      for (let op of binaryOps) {
        let expected = op;
        if (Array.isArray(op)) {
          expected = op[1];
          op = op[0];
        }
        it(`binary ${op} operator`, () => {
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
          expect(result.output).toEqual(soy`
            {namespace test.ts}

            {template .t}
              {@param a: string}
              {@param b: string}
            {$a ${expected} $b}
            {/template}
          `);
          expect(result.diagnostics.length).toEqual(0);
        });
      }

      it('text ternary', () => {
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
        expect(result.output).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param yes: bool}

            <div>
          {if $yes}
          <p>yes</p>
          {else}
          <p>no</p>
          {/if}
          </div>
          {/template}
        `);
      });

      it('expression ternary', () => {
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
        expect(result.output).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param yes: bool}

            <div>{1 + ($yes ? 1 : 2)}</div>
          {/template}
        `);
      });

      it(`error on strict equality`, () => {
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
        expect(result.diagnostics.length).toEqual(2);
        expect(result.diagnostics[0].message).toContain('=== is disallowed');
        expect(result.diagnostics[1].message).toContain('!== is disallowed');
        expect(() => {
          // tslint:disable-next-line:no-unused-expression Check for throw
          result.output;
        }).toThrow();
      });

      it('Array.length', () => {
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
        expect(result.output).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param a: list<string>}
          {length($a)}
          {/template}
        `);
        expect(result.diagnostics.length).toEqual(0);
      });

      it('String.length', () => {
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
        expect(result.output).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
          {strLen($a)}
          {/template}
        `);
        expect(result.diagnostics.length).toEqual(0);
      });

      it('String.includes()', () => {
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
        expect(result.output).toEqual(soy`
          {namespace test.ts}

          {template .t}
            {@param a: string}
          {strContains($a, 'a')}
          {/template}
        `);
        expect(result.diagnostics.length).toEqual(0);
      });

      it('Array.map', () => {
        const result = convertModule(
          'test.ts',
          js`
            import {html} from 'lit-html';

            /**
             * @soyCompatible
             */
            export const t = (items: string[]) => html\`
              <ul>
                \${items.map((item) => html\`<li>\${item}</li>\`)}
              </ul>
            \`;
          `
        );
        expect(result.output).toEqual(soy`
            {namespace test.ts}

            {template .t}
              {@param items: list<string>}

              <ul>
                
            {for $item in $items}
            <li>{$item}</li>
            {/for}

              </ul>

            {/template}
            `);
      });

      it('Array.map with free variables', () => {
        const result = convertModule(
          'test.ts',
          js`
            import {html} from 'lit-html';

            /**
             * @soyCompatible
             */
            export const t = (items: string[], x: boolean) => html\`
              <ul>
                \${items.map((item) => html\`<li>\${x ? item : ''}</li>\`)}
              </ul>
            \`;
          `
        );
        expect(result.output).toEqual(soy`
            {namespace test.ts}

            {template .t}
              {@param items: list<string>}
              {@param x: bool}

              <ul>
                
            {for $item in $items}
            <li>
            {if $x}
            {$item}
            {else}
            {''}
            {/if}
            </li>
            {/for}

              </ul>

            {/template}
            `);
      });

      it('variable declarations', () => {
        const result = convertModule(
          'test.ts',
          js`
            import {html} from 'lit-html';

            /**
             * @soyCompatible
             */
            export const t = () => {
              const x = 6 * 7;
              return html\`<p>The answer is $\{x}</p>\`;
            };
          `
        );
        expect(result.output).toEqual(soy`
            {namespace test.ts}

            {template .t}

            {let $x: 6 * 7 /}
            <p>The answer is {$x}</p>
            {/template}
            `);
      });

      it('object literals', () => {
        const result = convertModule(
          'test.ts',
          js`
            import {html} from 'lit-html';

            /**
             * @soyCompatible
             */
            export const t = () => {
              const foo = {x: 6 * 7, y: 'everything'};
              return html\`<p>The answer to \${foo.y} is $\{foo.x}</p>\`;
            };
          `
        );
        expect(result.output).toEqual(soy`
            {namespace test.ts}

            {template .t}

            {let $foo: record(x: 6 * 7, y: 'everything') /}
            <p>The answer to {$foo.y} is {$foo.x}</p>
            {/template}
            `);
      });
    });
  });
});
