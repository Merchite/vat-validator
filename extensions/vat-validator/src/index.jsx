import React, { useEffect, useMemo, useState } from 'react';
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
} from '@shopify/checkout-ui-extensions-react';

import { getAccessToken, getApiConfig } from './config.js';

render('Checkout::Dynamic::Render', () => <App />);

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

const debug = true;

function App() {
  const { shop } = useExtensionApi();
  const { myshopifyDomain } = shop;
  const canBlockProgress = useExtensionCapability('block_progress');
  const address = useShippingAddress();
  const customer = useCustomer();

  const vatNumberPattern = useMemo(() => /(^(BE0)[0-9]{9}$)|(^(NL)[0-9]{9}B[0-9]{2}$)|(^(DE)[0-9]{9}$)/i, []);
  const mailPattern = useMemo(() => /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/i, []);

  const [customerSavedVatNumber, setCustomerSavedVatNumber] = useState('');
  const [customerTaxExempt, setCustomerTaxExempt] = useState(false);
  const [businessUser, setBusinessUser] = useState(false);
  const [fullVatNumber, setFullVatNumber] = useState('');
  const [isValidRegex, setIsValidRegex] = useState(false);
  const [vatValidationError, setVatValidationError] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [isTaxExempt, setIsTaxExempt] = useState(false);
  const [vatNumberValidated, setVatNumberValidated] = useState(false);
  const [invoiceMail, setInvoiceMail] = useState('');
  const [mailValidationError, setMailValidationError] = useState('');
  const [reference, setReference] = useState('');
  const translate = useTranslate();
  const applyAttributeChange = useApplyAttributeChange();

  const getCustomerData = async () => {
    const accessToken = getAccessToken(`https://${myshopifyDomain}/`);
    const api_version = '2023-04';
    const query = `
      query {
        customer(id: "${customer.id}") {
          taxExempt,
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
      debug ? console.log("Data: ", data) : null;
      if (data.data.customer.metafield) {
        console.log("Found VAT number: ", data.data.customer.metafield.value);
        setBusinessUser(data.data.customer.metafield.value !== '' ? true : false)
        setFullVatNumber(data.data.customer.metafield.value);
        setCustomerSavedVatNumber(data.data.customer.metafield.value);
        setIsValidRegex(vatNumberPattern.test(data.data.customer.metafield.value));
        setCustomerTaxExempt(data.data.customer.taxExempt);
      }
    } catch (e) {
      debug ? console.log(e) : null;
    }
  };

  const validateVatNumber = async () => {
    setVatNumberValidated(false);
    const apiKey = getApiConfig(`https://${myshopifyDomain}/`);
    const apiUrl = `https://apilayer.net/api/validate?access_key=${apiKey}&vat_number=${fullVatNumber}`;
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error(translate('error_technical'));
      const data = await response.json();
      debug ? console.log("VAT validation response: ", data) : null;
      const isCompanyNameMatch = companyNamesMatch(address.company, data.company_name);
      debug ? console.log("Company name match: ", isCompanyNameMatch) : null;
      if (data.valid && isCompanyNameMatch) {
        setIsValid(true);
        if (address.countryCode !== 'NL') {
          setIsTaxExempt(true);
        } else if (address.countryCode === 'NL') {
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

  const updateCustomer = async (customerId, taxExempt, vatNumber, invoiceMail) => {
    const accessToken = getAccessToken(`https://${myshopifyDomain}/`);
    const api_version = '2023-04';

    const metafieldsSetBlock = (vatNumber || invoiceMail)
      ? `
        metafieldsSet(
          metafields: [
            ${vatNumber ? `{key: "vat_number", namespace: "sufio", ownerId: "${customerId}", type: "single_line_text_field", value: "${vatNumber}"}` : '' }
            ${invoiceMail ? `{key: "invoice_mail", namespace: "sufio", ownerId: "${customerId}", type: "single_line_text_field", value: "${invoiceMail}"}` : '' }
          ]
        ) {
          metafields {
            key
            namespace
            type
            value
          }
          userErrors {
            message
            field
          }
        }
        `
      : '';
  
    const mutation = `
      mutation {
        customerUpdate(
          input: {
            id: "${customerId}",
            taxExempt: ${taxExempt}
          }
        ) {
          customer {
            id
            taxExempt
          }
          userErrors {
            message
            field
          }
        }
        ${metafieldsSetBlock}
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
      debug ? console.log('Data: ', data) : null;
    } catch (error) {
      debug ? console.error(error) : null;
    }
  };

  useEffect(() => {
    if (customer) {
      getCustomerData();
    }
  }, []);

  useEffect(() => {
    if (isValidRegex) {
      setVatValidationError('');
      if (address.company !== '') {
        if (fullVatNumber !== customerSavedVatNumber || isTaxExempt !== customerTaxExempt) {
          validateVatNumber();
        }
      }
      debug ? console.log("Validate VAT number: ", fullVatNumber) : null;
    }
  }, [isValidRegex, address.company]);

  customer

  useEffect(() => {
    debug ? console.log(
      "VAT number validated:",
      fullVatNumber,
      "Is valid:",
      isValid,
      "Is tax exempt:",
      isTaxExempt
    ) : null;
    if (!isValid && fullVatNumber !== '') setVatValidationError(translate('error_invalid'));
    debug ? console.log("Tax exempt?", isTaxExempt) : null;
    if (vatNumberValidated && customer) {
      if (fullVatNumber !== customerSavedVatNumber) {
        updateCustomer(customer.id, isTaxExempt, fullVatNumber, invoiceMail);
      }
    }
  }, [vatNumberValidated]);

  useEffect(() => {
    if (!businessUser && customerSavedVatNumber !== '') {
      updateCustomer(customer.id, false);
    }
    if (businessUser && customerSavedVatNumber !== '' || isTaxExempt !== customerTaxExempt) {
      validateVatNumber();
    }
  }, [businessUser]);
  
  useEffect(() => {
    if (invoiceMail !== '') {
      setMailValidationError('');
      if (!mailPattern.test(invoiceMail)) {
        setMailValidationError(translate('error_mail'));
      }
    }
  }, [invoiceMail]);

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
              icon={vatValidationError
                ? 'warningFill'
                : fullVatNumber !== '' && isValid
                  ? 'success'
                  : 'infoFill' }
              label={translate("vat")}
              type="single_line_text_field"
              value={fullVatNumber}
              onChange={handleVatNumberChange}
              error={vatValidationError}
              required={canBlockProgress}
            />
            {!customer &&  address.countryCode !== "NL" && (
              <>
                <Text
                  size="medium"
                  appearance='warning'
                >
                  {translate('login_required')}
                </Text>
              </>
            )}
            <TextField
              icon="email"
              label={translate("invoice_mail")}
              type="single_line_text_field"
              value={invoiceMail}
              onChange={handleInvoiceMailChange}
              error={mailValidationError}
            />
            <TextField
              icon="note"
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
    // If vat number is entered but business user is unchecked, remove vat number
    if (!value && fullVatNumber !== '') {
      setFullVatNumber('');
      setIsValidRegex(false);
    }
    if (value && customer) setFullVatNumber(customerSavedVatNumber);
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
