// Native-federation config for the "forum" remote.
//
// The shareAll args + RxJS skip list live in ./federation-base.js (copied
// BYTE-IDENTICAL from the hugmesh-mastodon-ui peer, which copied it from the
// hugmesh.systems host) so this remote's federation surface can't drift from
// the host and the other HugMesh remotes. The remote name ("forum") and the
// exposed module key ("./routes") are the contract the host's loadRemoteModule()
// depends on — keep them stable.
const { hugmeshRemote } = require('./federation-base');

module.exports = hugmeshRemote({
  name: 'forum',
  exposes: {
    './routes': './src/app/forum.routes.ts',
  },
});
