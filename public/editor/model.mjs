export const UINT32_MAX = 4294967295;
const isUint32 = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= UINT32_MAX;

export function validateCategories(rows) {
  const errors = [];
  const keys = new Set();
  rows.forEach((row, index) => {
    const label = row.name || `分类 ${index + 1}`;
    if (!row.name?.trim()) errors.push('请填写分类名称');
    if (!/^[a-z][a-z0-9_]*$/.test(row.key)) errors.push(`${label}：标识需以小写字母开头，仅含小写字母、数字或下划线`);
    if (keys.has(row.key)) errors.push(`${label}：分类标识重复`);
    keys.add(row.key);
    if (!isUint32(row.start) || !isUint32(row.end)) errors.push(`${label}：ID 必须为 0–4294967295 的整数`);
    else if (Number(row.start) > Number(row.end)) errors.push(`${label}：起始 ID 不能大于结束 ID`);
    else rows.slice(0,index).forEach(other => {
      if (isUint32(other.start) && isUint32(other.end) && Number(row.start) <= Number(other.end) && Number(other.start) <= Number(row.end)) errors.push(`${label}：ID 范围与「${other.name}」重叠`);
    });
  });
  return errors;
}

export function toYaml(rows) {
  const errors = validateCategories(rows);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!rows.length) return 'version: 1\ncategories: []\n';
  return 'version: 1\ncategories:\n' + rows.map(row => `  - key: ${JSON.stringify(row.key)}\n    name: ${JSON.stringify(row.name)}\n    id_start: ${Number(row.start)}\n    id_end: ${Number(row.end)}\n    description: ${JSON.stringify(row.description || '')}\n`).join('');
}
