<h4 align="right"><strong><a href="README-en.md">English</a></strong> | 简体中文</h4>

<div align="center">
  <img src=".github/assets/cugent-logo.svg" alt="Cugent logo" width="128" height="128" />

  <h1>Cugent</h1>

  <p>
    从底层工具链定制的 AI 魔方助手
  </p>

  <p>
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=20232A" />
    <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
    <img alt="cubing.js" src="https://img.shields.io/badge/cubing.js-0.63-2EC4B6?style=for-the-badge" />
    <img alt="assistant-ui" src="https://img.shields.io/badge/assistant--ui-0.14-111111?style=for-the-badge" />
  </p>
</div>

Cugent 是一个以 AI Chat + 定制工具链和交互逻辑的站点，纯客户端，支持自定义 llm 提供商

## 主要功能

- 基本的 AI Chat 功能，会话/消息管理，流式输出
- 解析 `csTimer/DCTimer` 风格时间戳回顾
- 基于 `cubing.js` 追踪 3x3 状态，生成分段前后状态快照与阶段分析
- 根据复盘步骤自动推断 `Cross / F2L / OLL / PLL` 阶段。
- 对话流嵌入由公式决定的转动渲染动画

## 致谢

- [cstimer](https://github.com/cs0x7f/cstimer)：工具链核心算法参考
- [cubing.js](https://github.com/cubing/cubing.js)：魔方状态追踪与 3D 魔方播放器
- [assistant-ui](https://github.com/assistant-ui/assistant-ui)：AI Chat 基础搭建
- [shadcn/ui](https://ui.shadcn.com/)：组件与交互基础

## License

GPL v3.0
