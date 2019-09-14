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
import 'jasmine';
import {js} from '../lib/utils.js';
import {Grimlock} from '../lib/grimlock.js';
import * as path from 'path';

describe('grimlock', () => {
  const packageRoot = path.resolve(__dirname, '../');
  const grimlock = new Grimlock(packageRoot);

  describe('SourceFileConverter', () => {
    it('isImportOf', () => {
      const {converter} = grimlock.convertModule(
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
      expect(converter.isImportOf(litTemplate.tag, 'html', 'lit-html')).toBe(
        true
      );
      expect(converter.isImportOf(nonLitTemplate.tag, 'html', 'lit-html')).toBe(
        false
      );
    });
  });
});
