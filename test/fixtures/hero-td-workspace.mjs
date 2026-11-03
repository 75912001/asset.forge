// 测试独立使用的手工配置, 不作为实际项目的数据初始化来源.
export function gameWorkspace() {
  const common={weapon:'',damage:0,interval_ms:0,range_percent:0,slow_percent:0,slow_duration_ms:0,production:0,production_interval_ms:0,unlock_level:0};
  return {tables:{
    td_units:{rows:[
      {...common,id:1001,name:'聚灵阵',role:1,icon:'icons/聚灵阵.png',cost:50,hp:150,production:25,production_interval_ms:10000},
      {...common,id:1002,name:'黄忠',role:2,icon:'heroes/黄忠.png',weapon:'icons/弓.png',cost:100,hp:160,damage:25,interval_ms:1000,range_percent:800},
      {...common,id:1003,name:'张飞',role:3,icon:'heroes/张飞.png',cost:75,hp:600,damage:10,interval_ms:1000,range_percent:100},
      {...common,id:1004,name:'关羽',role:4,icon:'heroes/关羽.png',cost:150,hp:300,damage:40,interval_ms:1200,range_percent:125,unlock_level:3001},
      {...common,id:1005,name:'诸葛亮',role:5,icon:'heroes/诸葛亮.png',cost:125,hp:150,damage:10,interval_ms:1500,range_percent:800,slow_percent:50,slow_duration_ms:2500,unlock_level:3002},
    ]},
    td_enemies:{rows:[
      {id:2001,name:'步卒',icon:'enemies/步卒.png',hp:100,damage:20,interval_ms:1000,speed_percent:20},
      {id:2002,name:'快兵',icon:'enemies/快兵.png',hp:60,damage:15,interval_ms:800,speed_percent:45},
      {id:2003,name:'重甲步卒',icon:'enemies/重甲步卒.png',hp:300,damage:30,interval_ms:1200,speed_percent:12},
    ]},
    td_levels:{rows:[
      {id:3001,name:'守住城门',description:'学会经营灵气并守住防线.',duration_ms:120000,starting_energy:250,energy_per_second:5},
      {id:3002,name:'急袭来敌',description:'运用群攻应对快速和成群敌人.',duration_ms:180000,starting_energy:300,energy_per_second:5},
      {id:3003,name:'重兵压境',description:'运用减速抵挡混合进攻.',duration_ms:210000,starting_energy:350,energy_per_second:5},
    ]},
    td_spawns:{rows:[
      {id:4001,level_id:3001,time_ms:10000,lane:2,enemy_id:2001,count:1,spacing_ms:0},
      {id:4002,level_id:3001,time_ms:25000,lane:1,enemy_id:2001,count:2,spacing_ms:3000},
      {id:4003,level_id:3001,time_ms:45000,lane:3,enemy_id:2001,count:2,spacing_ms:3000},
      {id:4004,level_id:3001,time_ms:70000,lane:0,enemy_id:2001,count:2,spacing_ms:4000},
      {id:4005,level_id:3001,time_ms:75000,lane:4,enemy_id:2001,count:2,spacing_ms:4000},
      {id:4006,level_id:3001,time_ms:95000,lane:2,enemy_id:2001,count:3,spacing_ms:2500},
      {id:4011,level_id:3002,time_ms:15000,lane:2,enemy_id:2002,count:2,spacing_ms:4000},
      {id:4012,level_id:3002,time_ms:50000,lane:1,enemy_id:2001,count:4,spacing_ms:1000},
      {id:4013,level_id:3002,time_ms:60000,lane:3,enemy_id:2002,count:3,spacing_ms:4000},
      {id:4014,level_id:3002,time_ms:100000,lane:0,enemy_id:2001,count:4,spacing_ms:1000},
      {id:4015,level_id:3002,time_ms:115000,lane:4,enemy_id:2002,count:3,spacing_ms:4000},
      {id:4016,level_id:3002,time_ms:150000,lane:2,enemy_id:2001,count:5,spacing_ms:1000},
      {id:4021,level_id:3003,time_ms:15000,lane:2,enemy_id:2003,count:1,spacing_ms:0},
      {id:4022,level_id:3003,time_ms:50000,lane:0,enemy_id:2002,count:3,spacing_ms:3000},
      {id:4023,level_id:3003,time_ms:65000,lane:4,enemy_id:2001,count:4,spacing_ms:1000},
      {id:4024,level_id:3003,time_ms:95000,lane:1,enemy_id:2003,count:2,spacing_ms:8000},
      {id:4025,level_id:3003,time_ms:115000,lane:3,enemy_id:2002,count:4,spacing_ms:3000},
      {id:4026,level_id:3003,time_ms:155000,lane:2,enemy_id:2003,count:2,spacing_ms:8000},
      {id:4027,level_id:3003,time_ms:175000,lane:0,enemy_id:2001,count:4,spacing_ms:1000},
    ]},
  }};
}
