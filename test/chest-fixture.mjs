// 各层回归共用有效宝箱类型, 避免测试继续依赖已移除的独立外观数据.
export function chestEnum(icon='icons/chests/wood.png') {
  return {key:'chest_type',label:'宝箱类型',items:[{key:'undefined',label:'未定义',value:0},{key:'wood',label:'木箱',value:1,icon}]};
}
