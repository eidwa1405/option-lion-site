// تشفير كلمات المرور بدون مكتبات خارجية — يستخدم scrypt المدمجة في Node.js
const crypto = require('crypto');

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return 'scrypt:' + salt + ':' + hash;
}

function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt:');
}

// يرجع true لو تطابقت — يدعم أيضاً المقارنة المباشرة لكلمات المرور القديمة غير المشفّرة (نص صريح) للترحيل التلقائي
function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (isHashed(stored)) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const hash = parts[2];
    const check = crypto.scryptSync(String(plain), salt, 64).toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
    } catch (e) {
      return false;
    }
  }
  // كلمة مرور قديمة غير مشفّرة — مقارنة مباشرة (سيتم ترحيلها تلقائياً بعد أول دخول ناجح)
  return String(plain) === String(stored);
}

module.exports = { hashPassword, isHashed, verifyPassword };
