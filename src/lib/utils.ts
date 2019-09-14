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

import stripIndent = require('strip-indent');
import * as parse5 from 'parse5';

export const stripIndentTag = (trim: boolean = false) => (
  strings: TemplateStringsArray,
  ...values: any[]
) => {
  const result = stripIndent(
    values.reduce((acc, v, i) => acc + String(v) + strings[i + 1], strings[0])
  );
  return trim ? result.trim() : result;
};

/**
 * Remove indentation from a template literal containing JavaScript.
 */
export const js = stripIndentTag(true);

/**
 * Remove indentation from a template literal containing Soy.
 */
export const soy = stripIndentTag(true);

/**
 * Actions to be executed on nodes during a tree traversal.
 */
export type TraverseActions = {
  pre: (node: parse5.AST.Default.Node) => void;
  post: (node: parse5.AST.Default.Node) => void;
};

/**
 * Perform a tree traversal starting at the given node. Execute
 * pre-order and post-order actions on each node.
 */
export const traverseHtml = (
  node: parse5.AST.Node,
  actions: TraverseActions
) => {
  actions.pre(node as parse5.AST.Default.Node);
  if ((node as parse5.AST.Default.ParentNode).childNodes) {
    for (const child of (node as parse5.AST.Default.ParentNode).childNodes) {
      traverseHtml(child, actions);
    }
  }
  actions.post(node as parse5.AST.Default.Node);
};
