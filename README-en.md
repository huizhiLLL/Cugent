<h4 align="right">English | <strong><a href="README.md">简体中文</a></strong></h4>

<div align="center">
  <img src=".github/assets/cugent-logo.svg" alt="Cugent logo" width="128" height="128" />

  <h1>Cugent</h1>

  <p>
    An AI cube assistant built on a custom low-level toolchain
  </p>

  <p>
    <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=20232A" />
    <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
    <img alt="cubing.js" src="https://img.shields.io/badge/cubing.js-0.63-2EC4B6?style=for-the-badge" />
    <img alt="assistant-ui" src="https://img.shields.io/badge/assistant--ui-0.14-111111?style=for-the-badge" />
  </p>
</div>

Cugent is a pure client-side AI chat experience for cube solving, built with a custom toolchain and tailored interaction flow, with support for custom LLM providers.

## Main Features

- Basic AI chat features, including conversation and message management, plus streaming output
- Parsing for `csTimer/DCTimer` style timestamped solve reviews
- 3x3 state tracing with `cubing.js`, including per-stage snapshots and phase analysis
- Automatic inference of `Cross / F2L / OLL / PLL` stages from solve review steps
- Embedded turning animation previews in the chat flow driven by algorithms

## Acknowledgements

- [cstimer](https://github.com/cs0x7f/cstimer): reference for core toolchain algorithms
- [cubing.js](https://github.com/cubing/cubing.js): cube state tracing and 3D cube player
- [assistant-ui](https://github.com/assistant-ui/assistant-ui): foundation for the AI chat experience
- [shadcn/ui](https://ui.shadcn.com/): component and interaction foundation

## License

GPL v3.0
