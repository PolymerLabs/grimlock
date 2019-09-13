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

import {getReflectedAttributeName} from '../lib/reflected-attribute-name.js';

describe('reflectedAttributeName', () => {
  it('property with same reflected name', () => {
    expect(getReflectedAttributeName('value', 'input')).toEqual('value');
  });

  it('property with different reflected name', () => {
    expect(getReflectedAttributeName('className', 'input')).toEqual('class');
  });

  it('property with no reflection', () => {
    expect(getReflectedAttributeName('blah', 'input')).toBeUndefined();
  });

  it('global property', () => {
    expect(getReflectedAttributeName('id', 'div')).toEqual('id');
  });
});