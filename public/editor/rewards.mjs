import {UINT32_MAX} from './model.mjs';
import {rewardPickerHtml} from './reward-picker.mjs';
export function normalizeRewards(value,required=false) {
  if(!Array.isArray(value))throw new Error('奖励必须是对象数组');
  if(required&&!value.length)throw new Error('奖励列表不能为空');
  const seen=new Set();
  const integer=(value,positive)=>{
    if(!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>UINT32_MAX||Number(value)<(positive?1:0))throw new Error(positive?'数量必须是大于 0 的 uint32':'资产 ID 必须是 uint32');
    return Number(value);
  };
  return value.map(reward=>{
    if(!reward||typeof reward!=='object'||Array.isArray(reward))throw new Error('每项奖励必须包含 asset_id 和 count');
    const asset_id=integer(reward.asset_id,false),count=integer(reward.count,true);
    const value=Object.hasOwn(reward,'probability')?reward.probability:10000;
    if(!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||!Number.isInteger(Number(value))||Number(value)<0||Number(value)>10000)throw new Error('掉落概率必须是 0-10000 的整数, 10000 = 100%');
    const probability=Number(value);
    if(seen.has(asset_id))throw new Error(`奖励资产 ${asset_id} 重复, 请修改数量`);
    seen.add(asset_id);return {asset_id,count,probability};
  });
}
// Each callback supplies an independent uniform integer in [0, 10000).
export function rollRewards(value,rollForAsset) {
  return normalizeRewards(value).filter(reward=>{
    const roll=rollForAsset(reward.asset_id);
    if(!Number.isInteger(roll)||roll<0||roll>=10000)throw new Error('奖励判定值必须是 0-9999 的整数');
    return roll<reward.probability;
  });
}
export function rewardProbabilityText(value) {
  return ['number','string'].includes(typeof value)&&/^\d+$/.test(String(value))&&Number(value)<=10000?`${Number(value)/100}%`:'无效概率';
}
export function updateRewardProbability(input) {
  const preview=input.closest?.('.reward-probability-field')?.querySelector?.('.reward-percent');
  if(preview)preview.textContent=rewardProbabilityText(input.value);
}
export function rewardAssets(workspace) {
  return workspace.categories.filter(category=>!category.system).flatMap(category=>{
    const table=workspace.tables[category.key],hasIcon=table.fields.some(field=>field.key==='icon'&&field.type==='png');
    return table.rows.map(row=>({id:row.id,name:String(row.name||row.title||row.id),category:category.name,icon:hasIcon?row.icon||null:null,label:`${category.name} / ${row.name||row.title||row.id} · ${row.id}`}));
  });
}
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function rewardListHtml(value,assets,attrs='') {
  const rewards=Array.isArray(value)?value:[];
  return `<div class="reward-list">${rewards.length?'':'<p class="field-help">尚未添加奖励项. 点击下方"添加奖励", 即可设置资产、数量和概率.</p>'}${rewards.map((reward,index)=>{
    const text=String(reward.asset_id??'');
    const selected=assets.find(asset=>String(asset.id)===text)||(text?{id:text,name:`无效资产: ${text}`,category:'请重新选择'}:null);
    const probability=Object.hasOwn(reward,'probability')?reward.probability:10000;
    return `<div class="reward-row"><div class="reward-asset"><span>奖励资产</span><select hidden ${attrs} data-reward-index="${index}" data-reward-property="asset_id">${text!==''&&!assets.some(asset=>String(asset.id)===text)?`<option value="${esc(text)}" selected>无效资产: ${esc(text)}</option>`:''}<option value="" ${text===''?'selected':''}>选择道具或装备...</option>${assets.map(asset=>`<option value="${asset.id}" ${text===String(asset.id)?'selected':''}>${esc(asset.label)}</option>`).join('')}</select><button type="button" class="reward-picker-trigger" data-reward-picker aria-label="奖励资产" aria-haspopup="dialog" aria-expanded="false">${rewardPickerHtml(selected)}<span class="reward-picker-chevron" aria-hidden="true">⌄</span></button></div><label class="reward-count">数量<input ${attrs} data-reward-index="${index}" data-reward-property="count" value="${esc(reward.count??'')}" inputmode="numeric" aria-label="奖励数量" placeholder="数量"></label><label class="reward-probability-field">概率 / 万分率<input ${attrs} data-reward-index="${index}" data-reward-property="probability" value="${esc(probability??'')}" type="number" min="0" max="10000" step="1" inputmode="numeric" aria-label="掉落概率(万分率)"><small class="reward-percent">${rewardProbabilityText(probability)}</small></label><button class="table-icon-button" ${attrs} data-reward-remove="${index}" aria-label="移除奖励">×</button></div>`;
  }).join('')}<button class="text-button" ${attrs} data-reward-add>+ 添加奖励</button></div>`;
}
