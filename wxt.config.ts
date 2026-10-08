import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    // Public key pins the extension ID (mlfpneomdkdbknkiihofllhhecpdopcl) across dev/prod/unpacked
    // loads, so the AniList redirect URL https://mlfpneomdkdbknkiihofllhhecpdopcl.chromiumapp.org/ never changes.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw0O4EJ59riwJMyq+BMfZ39Z1fATA2WcRcTU71zilf5YbZx5C2LuFNYcTo+e+rHHp2eAcFw5TPwh6+NRkNWaeVb+XwjTF1FH7E+a8hG4GrYP4x0dpIzh6hOGe7ELpdfMWvzDUkKMmsG8Zy+qBGbgPxSMgtBshGqPFWB0dySdGL+6YIt/P2TbE/4boKuzBWy96ZTChtdMp0L2tM51RveghGT6Nh2/d5HSrp5UPtTxKRAUe1QdM1c21L5KuIQXNuHyJZ5m8VUrl+p+gaUmfY3pu4YQEN5pc7wjGIa4SrgltyObQ7agZMB9mD5ccwFgeyIXw5RkGfAJBsXntPLJrs9KgfQIDAQAB',
    name: 'Crunchy+',
    description: 'Sub/dub modes, a modern Crunchyroll UI, and AniList sync + import.',
    permissions: ['storage', 'identity'],
    host_permissions: ['*://*.crunchyroll.com/*', 'https://graphql.anilist.co/*', 'https://api.typesafe.ai/*'],
  },
});
