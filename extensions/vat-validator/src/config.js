export const getAccessToken = (storefrontUrl) => {
  // Fetch the access token from your secure location
  if (storefrontUrl === 'https://mt-test-st1.myshopify.com/') {
    return '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';
  }
  if (storefrontUrl === 'https://mastertools-stage.myshopify.com/') {
    return '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';
  }
  if (storefrontUrl === 'https://mastertools-nl.myshopify.com/') {
    return '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'
  }
}

export const getApiConfig = () => {
  // Fetch the API key from your secure location
  return '6f8e67a5c77db055f829c9baf0867f92';
};