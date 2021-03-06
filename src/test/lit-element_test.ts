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

import * as path from 'path';
import {Grimlock} from '../lib/grimlock.js';
import {SoyGenerator} from '../lib/soy-generator.js';
import {js, soy} from '../lib/utils.js';

describe('grimlock', () => {
  const packageRoot = path.resolve(__dirname, '../');
  const grimlock = new Grimlock(packageRoot, [SoyGenerator]);

  describe('lit-element', () => {
    it('converts a LitElement', () => {
      const result = grimlock.convertModule(
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
      expect(result.files[0].content).toEqual(
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
    const result = grimlock.convertModule(
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
    expect(result.files[0].content).toEqual(
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

  it('handles inherited properties', () => {
    const result = grimlock.convertModule(
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
    expect(result.files[0].content).toEqual(
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
    const result = grimlock.convertModule(
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
    expect(result.diagnostics[0].message).toEqual(
      'referenced properties must be annotated with @property()'
    );
    expect(() => {
      result.files[0].content;
    }).toThrow();
  });

  describe('event bindings', () => {
    it('converts event binding', () => {
      const result = grimlock.convertModule(
        'test.ts',
        js`
      import {LitElement, html} from 'lit-element';
      import {customElement} from 'lit-element/lib/decorators.js';

      /**
       * @soyCompatible
       */
      @customElement('my-element')
      export class MyElement extends LitElement {
        _onButtonClick() {}

        render() {
          return html\`<button @click=\${this._onButtonClick}>Click Me</button>\`;
        }
      }
    `
      );
      expect(result.files[0].content).toEqual(
        soy`
        {namespace test.ts}
        
        {template .MyElement}
          {@param children: string}
        <my-element>
        {$children}
        {call .MyElement_shadow /}</my-element>
        {/template}
        
        {template .MyElement_shadow}
        <button jsaction="click:{xid('_onButtonClick')}">Click Me</button>
        {/template}`
      );
    });

    it('converts event binding with reference to an inherited method', () => {
      const result = grimlock.convertModule(
        'test.ts',
        js`
      import {LitElement, html} from 'lit-element';
      import {customElement} from 'lit-element/lib/decorators.js';

      class ParentElement extends LitElement {
        _onButtonClick() {}
      }

      /**
       * @soyCompatible
       */
      @customElement('my-element')
      export class MyElement extends ParentElement {
        render() {
          return html\`<button @click=\${this._onButtonClick}>Click Me</button>\`;
        }
      }
    `
      );
      expect(result.files[0].content).toEqual(
        soy`
        {namespace test.ts}
        
        {template .MyElement}
          {@param children: string}
        <my-element>
        {$children}
        {call .MyElement_shadow /}</my-element>
        {/template}
        
        {template .MyElement_shadow}
        <button jsaction="click:{xid('_onButtonClick')}">Click Me</button>
        {/template}`
      );
    });

    it('does not convert unknown references', () => {
      const result = grimlock.convertModule(
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
          return html\`<button @click=\${this._doesNotExist}>Click Me</button>\`;
        }
      }
    `
      );
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].message).toContain('unknown class method');
      expect(result.files[0].content).toEqual(
        soy`
        {namespace test.ts}
        
        {template .MyElement}
          {@param children: string}
        <my-element>
        {$children}
        {call .MyElement_shadow /}</my-element>
        {/template}
        
        {template .MyElement_shadow}
        <button>Click Me</button>
        {/template}`
      );
    });

    it('does not convert event binding that is not an instance method reference.', () => {
      const result = grimlock.convertModule(
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
          return html\`<button @click=\${console.log}>Click Me</button>\`;
        }
      }
    `
      );
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].message).toContain(
        'event bindings must be instance method references: console.log'
      );
      expect(result.files[0].content).toEqual(
        soy`
        {namespace test.ts}
        
        {template .MyElement}
          {@param children: string}
        <my-element>
        {$children}
        {call .MyElement_shadow /}</my-element>
        {/template}
        
        {template .MyElement_shadow}
        <button>Click Me</button>
        {/template}`
      );
    });
  });
});
