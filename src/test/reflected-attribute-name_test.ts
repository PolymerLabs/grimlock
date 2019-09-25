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

import {getReflectedAttribute} from '../lib/reflected-attribute-name.js';

describe('reflectedAttributeName', () => {
  it('property with same reflected name', () => {
    expect(getReflectedAttribute('value', 'input')).toEqual({
      name: 'value',
      isBoolean: false
    });
  });

  it('property with different reflected name', () => {
    expect(getReflectedAttribute('className', 'input')).toEqual({
      name: 'class',
      isBoolean: false
    });
  });

  it('property with no reflection', () => {
    expect(getReflectedAttribute('blah', 'input')).toBeUndefined();
  });

  it('global property', () => {
    expect(getReflectedAttribute('id', 'div')).toEqual({
      name: 'id',
      isBoolean: false
    });
  });
});
