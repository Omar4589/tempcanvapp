import crypto from 'crypto';

export function deriveFallbackVuid(rec) {
  const key = [
    rec.first?.trim().toLowerCase() ?? '',
    rec.last?.trim().toLowerCase() ?? '',
    rec.line1?.trim().toLowerCase() ?? '',
    rec.city?.trim().toLowerCase() ?? '',
    rec.state?.trim().toLowerCase() ?? '',
    rec.zip?.trim() ?? ''
  ].join('|');
  return 'fv_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}
