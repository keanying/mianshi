'use strict';
// 岗位级别和达标线：五个级别的要求描述、默认达标分数，以及评估结果是否达标的判断。
// 主进程（出题、评估、导出报告）和界面共用。
(() => {
const DIMS = ['专业度', '自驱力', '性格特质', '逻辑思维', '适应力'];
// 默认达标线：平均分 + 每个维度的最低分（0~5，步长 0.5）。专业度、逻辑思维要求最高，其余略低。
const LEVELS = {
  初级: { desc: '在指导下完成开发任务，基础知识扎实，能讲清自己做过的事', average: 2.5, dims: { 专业度: 2.5, 自驱力: 2, 性格特质: 2, 逻辑思维: 2.5, 适应力: 2 } },
  中级: { desc: '能独立负责模块，理解原理，有排查问题和优化的实际经验', average: 3, dims: { 专业度: 3, 自驱力: 2.5, 性格特质: 2.5, 逻辑思维: 3, 适应力: 2.5 } },
  高级: { desc: '能主导项目和系统设计，有技术判断和取舍，能带新人', average: 3.5, dims: { 专业度: 3.5, 自驱力: 3, 性格特质: 3, 逻辑思维: 3.5, 适应力: 3 } },
  资深: { desc: '负责复杂系统的架构，推动技术方向，能带团队解决难题', average: 4, dims: { 专业度: 4, 自驱力: 3.5, 性格特质: 3.5, 逻辑思维: 4, 适应力: 3.5 } },
  专家: { desc: '领域内的权威，能定义技术方案和标准，解决行业级难题', average: 4.5, dims: { 专业度: 4.5, 自驱力: 4, 性格特质: 3.5, 逻辑思维: 4.5, 适应力: 4 } },
};
const LEVEL_NAMES = Object.keys(LEVELS);

const defaultPass = (level) => {
  const l = LEVELS[level] || LEVELS.中级;
  return { average: l.average, dims: { ...l.dims } };
};

// 是否达标：平均分不低于达标线，并且每个维度都不低于各自的最低分。
function judge(evaluation, pass) {
  if (!evaluation?.dimensions?.length || !pass) return null;
  const average = Math.round(evaluation.dimensions.reduce((a, d) => a + d.score, 0) / evaluation.dimensions.length * 10) / 10;
  const fails = evaluation.dimensions
    .filter((d) => typeof pass.dims?.[d.name] === 'number' && d.score < pass.dims[d.name])
    .map((d) => ({ name: d.name, score: d.score, need: pass.dims[d.name] }));
  const averageOk = average >= pass.average;
  return { passed: averageOk && !fails.length, average, averageOk, fails };
}

const api = { DIMS, LEVELS, LEVEL_NAMES, defaultPass, judge };
if (typeof module === 'object' && module.exports) module.exports = api;
else window.Levels = api;
})();
