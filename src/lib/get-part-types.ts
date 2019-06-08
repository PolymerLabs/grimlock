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
import * as parse5 from 'parse5';
const traverseHtml = require('parse5-traverse');

const isTextNode = (
  node: parse5.DefaultTreeNode
): node is parse5.DefaultTreeTextNode => node.nodeName === '#text';

const isElementNode = (
  node: parse5.DefaultTreeNode
): node is parse5.DefaultTreeElement => 'tagName' in node;

export type PartType = 'text' | 'attribute';

export const getPartTypes = (node: ts.TaggedTemplateExpression): PartType[] => {
  const template = node.template as ts.TemplateExpression;
  if (template.head === undefined) {
    return [];
  }

  const marker = '{{-lit-html-}}';
  const markerRegex = /{{-lit-html-}}/g;
  const strings = [
    template.head.text,
    ...template.templateSpans.map((s) => s.literal.text),
  ];
  const html = strings.join(marker);
  const fragment = parse5.parseFragment(html);
  let partTypes: PartType[] = [];
  traverseHtml(fragment, {
    pre(node: parse5.DefaultTreeNode, _parent: parse5.Node) {
      if (isTextNode(node)) {
        const text = node.value;
        const match = text.match(markerRegex);
        if (match !== null) {
          const exprCount = match.length;
          for (let i = 0; i < exprCount; i++) {
            partTypes.push('text');
          }
        }
      } else if (isElementNode(node)) {
        for (const attr of node.attrs) {
          const match = attr.value.match(markerRegex);
          if (match !== null) {
            const exprCount = match.length;
            for (let i = 0; i < exprCount; i++) {
              partTypes.push('attribute');
            }
          }
        }
      }
    },
  });
  return partTypes;
};
