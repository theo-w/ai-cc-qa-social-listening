import { getDatasets } from './apps/api/src/datasets.js';
import { analyzeSentiment } from './apps/api/src/engine/sentiment.js';

const datasets = getDatasets();
const items = datasets.sentiment.items;

const wrongByType = { contrast: [], weakNeg: [], implicitNeg: [], neutralQ: [], positiveWithNeg: [], other: [] };

for (const item of items) {
  const result = analyzeSentiment({ text: item.text });
  if (result.sentiment !== item.labels.sentiment) {
    const text = item.text.toLowerCase();
    const hasContrast = /还是[旧版|老版|以前|当初]/.test(text) || /以前[的|是|更|挺]/.test(text) || /不如[以前|当初|旧版|老版]/.test(text);
    const hasWeakNeg = /不太|有点|一般/.test(text);
    const hasPosWord = ['喜欢','满意','好玩','不错','开心','好','棒','赞','香','爽','牛','稳定','流畅','舒服','好看','好听','超值','划算','真香','奈斯','厉害','完美','推荐','期待','加油','精彩','用心','诚意','感动','爱了','给力','良心','感谢','支持','好评','点赞','太棒','优秀'].some(w => text.includes(w));
    const hasNegWord = ['bug','闪退','卡顿','掉线','回档','封号','误封','扣款','不到账','无法登录','登录不上','支付失败','外挂','开挂','挂机','服务器','崩溃','bug','敷衍','态度差','不回','不理','拖延','慢','贵','坑钱','吃相','卸载','弃坑','无语','离谱','过分','气死','拉胯','后悔','劝退','死机','黑屏','无法','失败','异常','错误','丢失','被盗','盗号','误判','割韭菜','逼氪','骗氪','诈骗','虚假','欺骗','缺德','难受','吐了','要命','不能忍','忍不了','受够','好烦','烦死','差劲','辣鸡','圈钱','不处理','没人管','垃圾','坑','骗','失望','恶心','差评','退游','退款','投诉','举报','曝光','维权'].some(w => text.includes(w));
    
    if (hasContrast) {
      wrongByType.contrast.push(item);
    } else if (hasWeakNeg) {
      wrongByType.weakNeg.push(item);
    } else if (hasPosWord && hasNegWord) {
      wrongByType.positiveWithNeg.push(item);
    } else if (!hasPosWord && !hasNegWord) {
      wrongByType.implicitNeg.push(item);
    } else if (item.labels.sentiment === 'neutral' && text.includes('？')) {
      wrongByType.neutralQ.push(item);
    } else {
      wrongByType.other.push(item);
    }
  }
}

console.log('=== 对比语境错误 ===');
for (const item of wrongByType.contrast) {
  console.log(`${item.id}: "${item.text.substring(0, 50)}..." 金标=${item.labels.sentiment}`);
}
console.log(`\n=== 弱否定错误 ===`);
for (const item of wrongByType.weakNeg) {
  console.log(`${item.id}: "${item.text.substring(0, 50)}..." 金标=${item.labels.sentiment}`);
}
console.log(`\n=== 正面+负面词共存 ===`);
for (const item of wrongByType.positiveWithNeg) {
  console.log(`${item.id}: "${item.text.substring(0, 50)}..." 金标=${item.labels.sentiment}`);
}
console.log(`\n=== 无明显正负面词 ===`);
for (const item of wrongByType.implicitNeg) {
  console.log(`${item.id}: "${item.text.substring(0, 50)}..." 金标=${item.labels.sentiment}`);
}
console.log(`\n=== 中性疑问 ===`);
for (const item of wrongByType.neutralQ) {
  console.log(`${item.id}: "${item.text.substring(0, 50)}..." 金标=${item.labels.sentiment}`);
}
console.log(`\n=== 其他 ===`);
for (const item of wrongByType.other) {
  console.log(`${item.id}: "${item.text.substring(0, 50)}..." 金标=${item.labels.sentiment}`);
}
