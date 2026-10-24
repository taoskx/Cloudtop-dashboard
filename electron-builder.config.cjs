'use strict';
module.exports = {
  appId: 'com.taoskx.cloudtop',
  productName: 'Cloudtop Dashboard',
  directories: { output: 'dist', buildResources: 'build' },
  asar: true,
  files: ['desktop.js', 'server.js', 'app/**/*.js', 'app/static/**/*', 'package.json'],
  extraResources: [
    { from: 'build/sidecar/cloudtop-sidecar.exe', to: 'engine/cloudtop-sidecar.exe' },
    { from: 'build/cloudtop.ico', to: 'cloudtop.ico' },
  ],
  win: { target: [{ target: 'portable', arch: ['x64'] }], icon: 'build/cloudtop.ico', executableName: 'Cloudtop Dashboard', requestedExecutionLevel: 'asInvoker' },
  portable: { artifactName: 'Cloudtop-Dashboard-v${version}-Windows-x64.exe' },
  publish: null,
};
