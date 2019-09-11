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

import {convertModule, js, soy} from './test-utils.js';

describe('grimlock', () => {
  describe('lit-element', () => {
    it('converts a LitElement', () => {
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
      expect(result.output).toEqual(
        soy`
        {namespace test.ts}
        
        {template .MyElement}
          {@param children: string}
        <my-element>
        {$children}
        {call .MyElement_shadow /}</my-element>
        {/template}
        
        {template .MyElement_shadow}
        <h1>Hello</h1>
        {/template}`
      );
    });
  });

  it('converts properties to params', () => {
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
    expect(result.output).toEqual(
      soy`
      {namespace test.ts}
      
      {template .MyElement}
        {@param children: string}
        {@param name: string}
      <my-element>
      {$children}
      {call .MyElement_shadow}{param name: $name /}
      {/call}</my-element>
      {/template}
      
      {template .MyElement_shadow}
        {@param name: string}
      <h1>Hello {$name}</h1>
      {/template}`
    );
  });

  it('supports defined custom elements', () => {
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
        return html\`
          <h1>Hello \${this.name}</h1>
          <child-element><div>child content \${this.name}</div></child-element>
        \`;
      }
    }
  `,
      {'child-element': 'ChildElement'}
    );
    expect(result.output).toEqual(
      soy`
      {namespace test.ts}
      
      {template .MyElement}
        {@param children: string}
        {@param name: string}
      <my-element>
      {$children}
      {call .MyElement_shadow}{param name: $name /}
      {/call}</my-element>
      {/template}
      
      {template .MyElement_shadow}
        {@param name: string}
      
            <h1>Hello {$name}</h1>
            {call .ChildElement}
      {param children kind="html"}<div>child content {$name}</div>
      {/param}
      {/call}
          
      {/template}`
    );
  });

  it('handles inherited properties', () => {
    const result = convertModule(
      'test.ts',
      js`
    import {LitElement, html} from 'lit-element';
    import {customElement, property} from 'lit-element/lib/decorators.js';

    class MyElementParent extends LitElement {
      @property() bar: string;
    }

    /**
     * @soyCompatible
     */
    @customElement('my-element')
    export class MyElement extends MyElementParent {

      render() {
        return html\`<h1>Hello \${this.bar}</h1>\`;
      }
    }
  `
    );
    expect(result.output).toEqual(
      soy`
      {namespace test.ts}
      
      {template .MyElement}
        {@param children: string}
        {@param bar: string}
      <my-element>
      {$children}
      {call .MyElement_shadow}{param bar: $bar /}
      {/call}</my-element>
      {/template}
      
      {template .MyElement_shadow}
        {@param bar: string}
      <h1>Hello {$bar}</h1>
      {/template}`
    );
  });

  it('errors when referenced property is not decorated with @property()', () => {
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
      bar: string;

      render() {
        return html\`<h1>Hello \${this.bar}</h1>\`;
      }
    }
  `
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toEqual('referenced properties must be annotated with @property()');
    expect(() => {
      result.output;
    }).toThrow();
  });
});
