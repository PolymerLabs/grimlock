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
  suite('lit-element', () => {
    test('converts a LitElement', () => {
      const result = convertModule(
        'test.ts',
        js`
      import {LitElement, html} from 'lit-element';
      import {customElement} from 'lit-element/lib/decorators.js';

      /**
       * @soyCompatible
       */
      @customElement('my-element')
      export class MyElement extends LitElement {
        render() {
          return html\`<h1>Hello</h1>\`;
        }
      }
    `
      );
      assert.equal(
        result.output,
        soy`
        {namespace test.ts}
        
        {template .MyElement}
          {@param children: string}
        <my-element>{$children}</my-element>
        {/template}
        
        {template .MyElement_shadow}
        <h1>Hello</h1>
        {/template}`
      );
    });
  });

  test('converts properties to params', () => {
    const result = convertModule(
      'test.ts',
      js`
    import {LitElement, html} from 'lit-element';
    import {customElement, property} from 'lit-element/lib/decorators.js';

    /**
     * @soyCompatible
     */
    @customElement('my-element')
    export class MyElement extends LitElement {
      @property() name: string;

      render() {
        return html\`<h1>Hello \${this.name}</h1>\`;
      }
    }
  `
    );
    // console.log(result.diagnostics);
    // console.log(result.output);
    assert.equal(
      result.output,
      soy`
      {namespace test.ts}
      
      {template .MyElement}
        {@param children: string}
        {@param name: string}
      <my-element>{$children}</my-element>
      {/template}
      
      {template .MyElement_shadow}
        {@param name: string}
      <h1>Hello {$name}</h1>
      {/template}`
    );
  });
});
