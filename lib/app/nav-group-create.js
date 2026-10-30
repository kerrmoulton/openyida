'use strict';

const { CliError } = require('../core/cli-error');
const { resolveFormNavIcon } = require('./create-form/nav-icon');
const { buildFormNavigationIconUpdatePayload } = require('./create-form/nav-icon-service');

/** Create a group, then persist a semantic icon using the platform navigation protocol. */
async function createGroupWithIcon(appType, name, flags, authRef, dependencies) {
  const { fetchNavigationList, postNavAction, resolveNode, buildI18nTitle,
    getNodeName, normalizeNavNode, rootNavUuid } = dependencies;
  if (!name) {throw new Error('Group name is required');}
  const selection = resolveFormNavIcon(flags.icon, name, []);
  if (!selection.icon) {
    throw new CliError('Invalid navigation icon. Use auto or a supported page navigation icon name.', {
      code: 'NAV_GROUP_ICON_INVALID', details: { icon: flags.icon, retrySafe: true },
    });
  }
  const list = await fetchNavigationList(appType, authRef);
  const parent = resolveNode(list, flags.parent || rootNavUuid, { groupOnly: true });
  if (parent.navUuid !== rootNavUuid && parent.parentNavUuid !== rootNavUuid) {
    throw new Error('New groups can only be created at root or under a top-level group');
  }

  const beforeIds = new Set(list.map((node) => node.navUuid));
  let created;
  let stage = 'create';
  try {
    // Do not replay a creation on an uncertain response: it can duplicate the group.
    await postNavAction(appType, 'save', {
      parentNavUuid: parent.navUuid,
      title: JSON.stringify(buildI18nTitle(name, flags.en)),
    }, authRef, { oneShot: true });
    stage = 'resolve';
    const updatedList = await fetchNavigationList(appType, authRef);
    const matches = updatedList.filter((node) => node.navType === 'NAV' &&
      !beforeIds.has(node.navUuid) && getNodeName(node) === name &&
      (node.parentNavUuid || rootNavUuid) === parent.navUuid);
    if (matches.length !== 1) {
      throw new Error('Created group could not be resolved uniquely.');
    }
    created = matches[0];
    stage = 'icon';
    await postNavAction(appType, 'update',
      buildFormNavigationIconUpdatePayload(created, selection.icon), authRef, { oneShot: true });
    stage = 'readback';
    const observed = await fetchNavigationList(appType, authRef);
    const verified = resolveNode(observed, created.navUuid, { groupOnly: true });
    if (verified.icon !== selection.icon) {
      throw new Error('Group navigation icon readback did not match the requested icon.');
    }
    return {
      success: true, appType, action: 'create', group: normalizeNavNode(verified),
      iconSource: selection.source, readbackVerified: true,
    };
  } catch (error) {
    throw new CliError(error.message, {
      code: 'NAV_GROUP_CREATE_INCOMPLETE',
      details: {
        appType, stage, name, parentNavUuid: parent.navUuid,
        navUuid: created ? created.navUuid : null, expectedIcon: selection.icon,
        partial: stage !== 'create', sideEffectState: created ? 'committed' : 'unknown',
        retrySafe: false, readbackVerified: false, readbackAllowed: true,
        nextStep: `openyida nav-group list ${appType} --flat`,
      },
    });
  }
}

module.exports = { createGroupWithIcon };
