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

import {LitElement, html} from 'lit-element';

/**
 * @soyCompatible
 */
export const subTemplate = () => html`<div>whoa</div>`;

/**
 * @soyCompatible
 */
export const testTemplate = (name: string) => html`
  <h1>Hello ${name + 'a'}</h1>
  ${subTemplate()}
`;

/**
 * @soyCompatible
 */
export class TestElement extends LitElement {
  render() {
    return html`<p>Cool, cool, cool...</p>`;
  }
}
