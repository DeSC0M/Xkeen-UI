const KEY = 'xkeen.modules.update.v2';

function readBadge() {
  try {
    const record = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return record?.schema === 2 && typeof record.sourceVersion === 'string' && typeof record.targetVersion === 'string'
      && (record.channel === 'stable' || record.channel === 'prerelease')
      ? record : null;
  } catch (error) {
    return null;
  }
}

export function syncModulesUpdateBadges(scope = document) {
  const badge = readBadge();
  scope.querySelectorAll('[data-xk-modules-update-badge]').forEach((node) => {
    node.hidden = !badge;
    node.textContent = badge ? 'Обновление' : '';
    node.setAttribute('aria-label', badge ? `Доступно обновление ${badge.targetVersion}` : '');
  });
  // The item sits inside a closed menu: its trigger carries a dot.
  scope.querySelectorAll('[data-xk-modules-update-dot]').forEach((node) => { node.hidden = !badge; });
}

export function setModulesUpdateBadge({ sourceVersion, targetVersion, channel = 'stable' }) {
  if (!sourceVersion || !targetVersion || sourceVersion === targetVersion) return false;
  if (channel !== 'stable' && channel !== 'prerelease') return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ schema: 2, sourceVersion, targetVersion, channel }));
  } catch (error) {
    return false;
  }
  syncModulesUpdateBadges(document);
  return true;
}

export function clearModulesUpdateBadge() {
  try { sessionStorage.removeItem(KEY); } catch (error) {}
  syncModulesUpdateBadges(document);
}

export function reconcileModulesUpdateBadge(installed) {
  const badge = readBadge();
  if (!badge) return;
  const current = installed?.panel_version;
  if (current && (current !== badge.sourceVersion || installed?.update_channel !== badge.channel)) clearModulesUpdateBadge();
}

export function reconcileModulesUpdatePlan(plan, channel = 'stable') {
  if (plan?.operation !== 'panel-update') return;
  if (plan.blockers?.some((blocker) => blocker?.code === 'panel_version_current')) {
    clearModulesUpdateBadge();
  } else if (plan.applicable === true) {
    setModulesUpdateBadge({ sourceVersion: plan.source_version, targetVersion: plan.target_version, channel });
  }
}

export function reconcileModulesUpdateCheck(check) {
  if (check?.update_available === true && check.requires_installer !== true) {
    setModulesUpdateBadge({ sourceVersion: check.source_version, targetVersion: check.target_version, channel: check.channel || 'stable' });
  } else {
    clearModulesUpdateBadge();
  }
}

export function reconcileModulesUpdateStatus(status) {
  if (status?.operation === 'panel-update' && status.result === 'committed') clearModulesUpdateBadge();
}
