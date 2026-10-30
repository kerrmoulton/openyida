'use strict';

// Server-derived provenance: channels may grow; only absence or "none" means non-AI.
function isAgentAppType(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const type = value.trim().toLowerCase();
  return type !== '' && type !== 'none';
}

module.exports = { isAgentAppType };
