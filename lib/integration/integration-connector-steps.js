'use strict';

function getConnectorEditorSteps(connectorConfig, connectionId) {
  const connectionLess = connectorConfig && connectorConfig.connectionLess;
  const requiresConnection = connectionLess === false
    || (connectionLess !== true && Boolean(connectionId));

  return {
    allStepCounts: requiresConnection ? 3 : 2,
    currentStep: requiresConnection && connectionId ? 2 : 1,
  };
}

module.exports = { getConnectorEditorSteps };
