import { getDatasets } from './apps/api/src/datasets.js';
import { analyzeSentiment } from './apps/api/src/engine/sentiment.js';

const datasets = getDatasets();
const items = datasets.sentiment.items;

const sentimentWrong = [];
const sentimentCorrect = [];
const alertWrong = [];

for (const item of items) {
  const result = analyzeSentiment({ text: item.text });
  
  if (result.sentiment !== item.labels.sentiment) {
    sentimentWrong.push({
      id: item.id, text: item.text,
      gold: item.labels.sentiment, pred: result.sentiment,
      rules: result.engineRules,
      topics: result.topics, goldTopics: item.labels.topics,
    });
  } else {
    sentimentCorrect.push(item.id);
  }
  
  const goldLevel = item.labels.expectedLevel;
  const predLevel = result.severity;
  if (goldLevel !== predLevel) {
    alertWrong.push({
      id: item.id, text: item.text,
      gold: goldLevel, pred: predLevel,
      goldSentiment: item.labels.sentiment, predSentiment: result.sentiment,
      rules: result.engineRules,
    });
  }
}

console.log(`情感正确: ${sentimentCorrect.length}/${items.length} = ${(sentimentCorrect.length/items.length*100).toFixed(1)}%`);
console.log(`情感错误: ${sentimentWrong.length} 条`);
console.log(`级别错误: ${alertWrong.length} 条\n`);

console.log('=== 情感错误详情 ===');
for (const w of sentimentWrong) {
  console.log(`${w.id}: "${w.text.substring(0, 60)}..."`);
  console.log(`  金标=${w.gold} 预测=${w.pred} 规则=${w.rules.join(', ')}`);
  console.log(`  主题: 金标=[${w.goldTopics.join(',')}] 预测=[${w.topics.join(',')}]`);
  console.log();
}
