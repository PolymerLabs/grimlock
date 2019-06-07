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

import ts from 'typescript';
import {assert} from 'chai';
import {convertModule, js} from './test-utils.js';

suite('grimlock', () => {
  suite('SourceFileConverter', () => {
    test('isImportOf', () => {
      const converter = convertModule(
        'test.ts',
        js`
      import {html} from 'lit-html';

      const t2 = () => html\`<div></div>\`;

      {
        const html = () => null;
        const t2 = () => html\`<div></div>\`;
      }
    `
      );
      const findTaggedTemplateExpressions = (
        node: ts.Node,
        results: ts.TaggedTemplateExpression[] = []
      ): ts.TaggedTemplateExpression[] => {
        if (ts.isTaggedTemplateExpression(node)) {
          results.push(node);
        }
        for (const child of node.getChildren()) {
          findTaggedTemplateExpressions(child, results);
        }
        return results;
      };
      const templates = findTaggedTemplateExpressions(converter.sourceFile);
      const litTemplate = templates[0];
      const nonLitTemplate = templates[1];
      assert.isTrue(converter.isImportOf(litTemplate.tag, 'html', 'lit-html'));
      assert.isFalse(
        converter.isImportOf(nonLitTemplate.tag, 'html', 'lit-html')
      );
    });
  });
});
