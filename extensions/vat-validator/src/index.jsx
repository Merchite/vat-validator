// To fix
// Add option to login when no customer and valid vat number
import React, { useEffect, useMemo, useReducer, useState } from 'react';
import {
  useExtensionApi,
  useExtensionCapability,
  useApplyAttributeChange,
  useBuyerJourneyIntercept,
  useShippingAddress,
  useCustomer,
  useTranslate,
  render,
  BlockStack,
  Heading,
  Checkbox,
  TextField,
  Text,
  Link,
} from '@shopify/checkout-ui-extensions-react';

import { getAccessToken, getApiConfig } from './config.js';

render('Checkout::Dynamic::Render', () => <App />);

// Helper function to check if company names match
const companyNamesMatch = (shippingCompany, responseCompany) => {
  const shippingCompanyName = shippingCompany.toLowerCase().replace(/[^\w\s]/gi, '');
  const responseCompanyName = responseCompany.toLowerCase().replace(/[^\w\s]/gi, '');
  const maxLength = Math.max(shippingCompanyName.length, responseCompanyName.length);
  const minLength = Math.min(shippingCompanyName.length, responseCompanyName.length);
  const matchThreshold = maxLength * 0.9;
  let matches = 0;
  for (let i = 0; i < minLength; i++) {
    if (shippingCompanyName[i] === responseCompanyName[i]) {
      matches++;
    }
  }
  return matches >= matchThreshold;
};

function App() {
  const { extensionPoint, shop } = useExtensionApi();
  const { myshopifyDomain } = shop;
  const translate = useTranslate();
  const [businessUser, setBusinessUser] = useState(false);
  const [fullVatNumber, setFullVatNumber] = useState('');
  const [vatValidationError, setVatValidationError] = useState('');
  const canBlockProgress = useExtensionCapability('block_progress');
  const applyAttributeChange = useApplyAttributeChange();
  const [isValidRegex, setIsValidRegex] = useState(false);
  const vatNumberPattern = useMemo(() => /(^(BE0)[0-9]{9}$)|(^(NL)[0-9]{9}B[0-9]{2}$)|(^(DE)[0-9]{9}$)/i, []);
  const [invoiceMail, setInvoiceMail] = useState('');
  const [mailValidationError, setMailValidationError] = useState('');
  const mailPattern = useMemo(() => /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/i, []);
  const [reference, setReference] = useState('');
  const [isValid, setIsValid] = useState(false);
  const address = useShippingAddress();
  const customer = useCustomer();
  const [vatNumberValidated, setVatNumberValidated] = useState(false);
  const [isTaxExempt, setIsTaxExempt] = useState(false);

  console.log("Shopify domain: ", myshopifyDomain);

  const getVatNumber = async () => {
    const accessToken = getAccessToken(`https://${myshopifyDomain}/`);
    const api_version = '2023-04';
    const query = `
      query {
        customer(id: "${customer.id}") {
          metafield(namespace: "sufio", key: "vat_number") {
            value
          }
        }
      }
    `;
    try {
      const response = await fetch(`https://${myshopifyDomain}/admin/api/${api_version}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) throw new Error(translate('error_technical'));
      const data = await response.json();
      if (data.data.customer.metafield) {
        setFullVatNumber(data.data.customer.metafield.value);
      }
    } catch (e) {
      console.log(e);
    }
  };

  useEffect(() => {
    if (customer) {
      getVatNumber();
    }
  }, [customer]);

  const validateVatNumber = async () => {
    const apiKey = getApiConfig(`https://${myshopifyDomain}/`);
    const apiUrl = `https://apilayer.net/api/validate?access_key=${apiKey}&vat_number=${fullVatNumber}`;
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error(translate('error_technical'));
      const data = await response.json();
      const isCompanyNameMatch = companyNamesMatch(address.company, data.company_name);
      if (data.valid && isCompanyNameMatch) {
        setIsValid(true);
        if (address.countryCode !== 'NL') {
          setIsTaxExempt(true);
        }
        if (address.countryCode === 'NL') {
          setIsTaxExempt(false);
          setVatValidationError(translate('error_valid_native'));
        }
          
      }
      if (!data.valid) {
        throw new Error(translate('error_invalid'));
      }
      if (!isCompanyNameMatch) {
        throw new Error(translate('error_company_name'));
      }
    } catch (e) {
      setVatValidationError(e.message || translate('error_technical'));
    } finally {
      setVatNumberValidated(true);
    }
  };

  useEffect(() => {
    if (isValidRegex) {
      setVatValidationError('');
      validateVatNumber();
    }
  }, [isValidRegex]);

  useEffect(() => {
    if (isValidRegex) {
      setVatValidationError('');
      validateVatNumber();
    }
  }, [address.company]);
  
  const mutateCustomer = async () => {
    const accessToken = getAccessToken(`https://${myshopifyDomain}/`);
    const api_version = '2023-04';
    const mutation = `
    mutation {
      customerUpdate(
          input: {
            id: "${customer.id}",
            taxExempt: ${isTaxExempt},
            metafields: [
              ${ fullVatNumber ? `{ namespace: "sufio", key: "vat_number", value: "${fullVatNumber}", type: "single_line_text_field" }` : '' }
              ${ invoiceMail ? `{ namespace: "business", key: "invoice_mail", value: "${invoiceMail}", type: "single_line_text_field" }` : '' }
              ${ reference ? `{ namespace: "business", key: "reference", value: "${reference}", type: "single_line_text_field" }` : '' }
            ]
          }
        ) {
          customer {
            id
            taxExempt
            metafields(first: 3) {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
          userErrors {
            message
            field
          }
        }
      }
    `;
    try {
      const response = await fetch(`https://${myshopifyDomain}/admin/api/${api_version}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query: mutation }),
      });
      const data = await response.json();
    } catch (error) {
      console.error(error);
    }
  };  
    
  useEffect(() => {
    if (!isValid && fullVatNumber !== '') setVatValidationError(translate('error_invalid'));
    if (vatNumberValidated && customer) mutateCustomer();
  }, [vatNumberValidated]);
  
  useEffect(() => {
    // Check if invoice mail is valid
    if (mailPattern.test(invoiceMail)) {
      setMailValidationError('');
    } else if (invoiceMail !== '') {
      setMailValidationError(translate('error_mail'));
    }
  }, [invoiceMail]);

  // When customer presses 'Continue to shipping' button in checkout run function mutateCustomer()


  useBuyerJourneyIntercept(({ canBlockProgress }) => {
    if (canBlockProgress && !isValidRegex && fullVatNumber !== '') {
      return {
        behavior: 'block',
        reason: 'Please enter a valid VAT number.',
        perform: () => {
          setVatValidationError(translate('error_format'));
        },
      };
    }
    if (canBlockProgress && isValid && isTaxExempt && !customer) {
      return {
        behavior: 'block',
        reason: 'Please login or create an account to order tax exempt.',
        perform: () => {
          setVatValidationError(translate('error_login'));
        },
      };
    }
    return {
      behavior: 'allow',
      perform: () => {
        setVatValidationError('');
      },
    };
  });

  return (
    <>
      <BlockStack border="base" padding="base" cornerRadius="large">
        <Heading>{translate('business_header')}</Heading>
        <Checkbox
          id="business-user"
          name="business-user"
          value={businessUser}
          onChange={handleCustomerTypeChange}
        >
          {translate('business_user')}
        </Checkbox>
        {businessUser && (
          <>
            <TextField
              label={translate("vat")}
              type="single_line_text_field"
              value={fullVatNumber}
              onChange={handleVatNumberChange}
              error={vatValidationError}
              required={canBlockProgress}
            />
            {isTaxExempt && !customer && (
              <>
                <Text>{translate('login_required')}</Text>
                <Link to="https://customer.login.shopify.com/lookup?destination_uuid=89ecc134-606c-454e-bb0b-6fcd9172527c&redirect_uri=https%3A%2F%2Fshopify.com%2F51160154280%2Faccount%2Fcallback&rid=339352dc-c3ac-4e67-a004-9712fa7b77d8&ui_locales=nl-NL">
                  {translate('login')}
                </Link>
              </>
            )}
            <TextField
              label={translate("invoice_mail")}
              type="single_line_text_field"
              value={invoiceMail}
              onChange={handleInvoiceMailChange}
              error={mailValidationError}
            />
            <TextField
              label={translate("reference")}
              type="single_line_text_field"
              value={reference}
              onChange={handleReferenceChange}
            />
          </>
        )}
      </BlockStack>
    </>
  );

  async function handleCustomerTypeChange(value) {
    setBusinessUser(value);
    const result = await applyAttributeChange({
      type: 'updateAttribute',
      key: 'Business user',
      value: value,
    });
  };

  async function handleVatNumberChange(value) {
    setFullVatNumber(value);
    setIsValidRegex(vatNumberPattern.test(value));
    const result = await applyAttributeChange({
      type: 'updateAttribute',
      key: 'VAT Registration Number',
      value: value,
    });
  };

  async function handleInvoiceMailChange(value) {
    setInvoiceMail(value);
    const result = await applyAttributeChange({
      type: 'updateAttribute',
      key: 'Billing Mail',
      value: value,
    });
  };
  
  async function handleReferenceChange(value) {
    setReference(value);
    const result = await applyAttributeChange({
      type: 'updateAttribute',
      key: 'Note',
      value: value,
    });
  };
}
