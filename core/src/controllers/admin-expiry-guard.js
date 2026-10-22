/**
 * 到期用户即时拦截。
 * 用最新的用户数据判断，不能依赖登录会话里的 card 快照。
 */
function isCurrentUserExpired(req, userStore) {
  const currentUser = req && req.currentUser;
  if (!currentUser || !currentUser.username) return false;
  if (!userStore || typeof userStore.isUserExpired !== "function") return false;
  try {
    return userStore.isUserExpired(currentUser.username) === true;
  } catch {
    return false;
  }
}

/**
 * 到期用户禁止写账号。返回 true 表示已响应，调用方应立即 return。
 */
function rejectExpiredUser(req, res, userStore, message) {
  if (!isCurrentUserExpired(req, userStore)) return false;
  res.status(403).json({
    ok: false,
    expired: true,
    error: message || "账号已到期，已禁止添加或更新账号，请续费后再试",
  });
  return true;
}

module.exports = {
  isCurrentUserExpired,
  rejectExpiredUser,
};
