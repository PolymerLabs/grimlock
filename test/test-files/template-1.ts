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
