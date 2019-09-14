/**
 * Elements and their special properties that should be reflected to attributes
 * when set.
 *
 * Modify this object to add reflected attributes.
 *
 * Each item in the array takes the following format:
 *
 * first: Element name or array of element names.
 * rest:  Array of ([property name, reflected attribute name] or
 *        property name (if reflected attribute name is identical).
 */
const reflectedAttributesSource: Array<{
  tagNames: string[];
  reflections: (string | string[])[];
}> = [
  {
    tagNames: ['input', 'option'],
    reflections: ['value'],
  },
  {
    tagNames: ['*'],
    reflections: [['className', 'class'], 'id'],
  },
];

// reflectedAttributesSource is easy to visually parse, but we can reconfigure the
// data structure into a map of maps for faster lookup at runtime.
const reflectedAttributes = new Map<string, Map<string, string>>();
const addReflectionForElement = (
  elementName: string,
  propertyName: string,
  attributeName: string
) => {
  let reflectedAttribute = reflectedAttributes.get(elementName);
  if (reflectedAttribute === undefined) {
    reflectedAttribute = new Map();
    reflectedAttributes.set(elementName, reflectedAttribute);
  }
  reflectedAttribute.set(propertyName, attributeName);
};
const addReflectionsForElement = (
  elementName: string,
  reflections: Array<string | Array<string>>
) => {
  for (const reflection of reflections) {
    let propertyName, attributeName;
    if (Array.isArray(reflection)) {
      propertyName = reflection[0];
      attributeName = reflection[1];
    } else {
      propertyName = reflection;
      attributeName = reflection;
    }
    addReflectionForElement(elementName, propertyName, attributeName);
  }
};
for (const entry of reflectedAttributesSource) {
  for (const elementName of entry.tagNames) {
    addReflectionsForElement(elementName, entry.reflections);
  }
}

/**
 * Given a property name and element tag name, return the name of the corresponding
 * reflected attribute, or undefined if it doesn't exist.
 */
export const getReflectedAttributeName = (
  propertyName: string,
  tagName: string
) => {
  const attributes = reflectedAttributes.get(tagName);
  if (attributes !== undefined && attributes.has(propertyName)) {
    return attributes.get(propertyName);
  } else {
    return reflectedAttributes.get('*')!.get(propertyName);
  }
};
