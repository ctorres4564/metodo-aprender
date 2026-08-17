(function(global){
  "use strict";

  function randomPart(){
    if(global.crypto && typeof global.crypto.randomUUID === "function"){
      return global.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if(global.crypto && typeof global.crypto.getRandomValues === "function"){
      global.crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function generateConceptId(){
    return `c-${randomPart()}`;
  }

  function ensureConceptId(concept){
    return Object.assign({}, concept, { id: concept && concept.id || generateConceptId() });
  }

  function replaceConcept(concept){
    const previousId = concept && concept.id || null;
    const replacement = Object.assign({}, concept, { id: generateConceptId() });
    if(previousId) replacement.replacesConceptId = previousId;
    return replacement;
  }

  global.ConceptIdentity = { generateConceptId, ensureConceptId, replaceConcept };
})(typeof window !== "undefined" ? window : globalThis);
