// allow a non-production service endpoint to be used for testing the cli, passed via an (undocumented) env var
export const SERVICE_HOST =
  process.env.BOXCI__TEST__SERVICE || 'https://boxci.dev'
