import * as url from 'url'

import { PackageInitParams } from './types'
import { sign, verify } from './util/signature'
import { getPublicKey } from './util/publicKey'
import { parseSignatureHeader } from './util/parser'

/**
 * Helper function to construct the basestring and verify the signature of an
 * incoming request
 * @param uri String
 * @param submissionId MongoDB submission ObjectId
 * @param formId MongoDB submission ObjectId
 * @param epoch Number of milliseconds since Jan 1, 1970
 * @param signature base64 encoded signature
 * @param webhookPublicKey base64 webhook public key
 */
function verifySignature(
  uri: string,
  submissionId: string,
  formId: string,
  epoch: number,
  signature: string,
  webhookPublicKey: string
) {
  const baseString = `${url.parse(uri).href}.${submissionId}.${formId}.${epoch}`
  return verify(baseString, signature, webhookPublicKey)
}

/**
 * Helper function to verify that the epoch submitted is recent.
 * Prevents against replay attacks.
 * @param epoch The number of milliseconds since Jan 1, 1979
 * @param expiry Duration of expiry. The default is 5 minutes.
 */
function verifyEpoch(epoch: number, expiry: number = 300000) {
  const difference = Date.now() - epoch
  return difference > 0 && difference < expiry
}

/**
 * Higher order function that injects the webhook public key for authentication
 * @param webhookPublicKey The FormSG webhook public key
 */
function authenticate(webhookPublicKey: string) {
  /**
   * Injects the webhook public key for authentication
   * @param header X-FormSG-Signature header
   * @param uri The endpoint that FormSG is POSTing to
   * @throws {Error} If the signature or uri cannot be verified
   */
  function _internalAuthenticate(header: string, uri: string) {
    // Parse the header
    const {
      v1: signature,
      t,
      s: submissionId,
      f: formId,
    } = parseSignatureHeader(header)
    const epoch = Number(t)

    if (!epoch || !signature || !submissionId || !formId) {
      throw new Error('X-FormSG-Signature header is invalid')
    }

    // Verify signature authenticity
    if (
      !verifySignature(
        uri,
        submissionId,
        formId,
        epoch,
        signature,
        webhookPublicKey
      )
    ) {
      throw new Error(
        `Signature could not be verified for uri=${uri} submissionId=${submissionId} formId=${formId} epoch=${epoch} signature=${signature}`
      )
    }

    // Verify epoch recency
    if (!verifyEpoch(epoch)) {
      throw new Error(
        `Signature is not recent for uri=${uri} submissionId=${submissionId} formId=${formId} epoch=${epoch} signature=${signature}`
      )
    }
  }

  return _internalAuthenticate
}

/**
 * Generates a signature based on the URI, submission ID and epoch timestamp.
 * @param {String} webhookSecretKey The base64 secret key
 * @returns The generated signature
 */
function generateSignature(webhookSecretKey: string) {
  /**
   *
   * @param params The parameters needed to generate the signature
   * @param params.uri Full URL of the request
   * @param params.submissionId Submission Mongo ObjectId saved to the database
   * @param params.epoch Number of milliseconds since Jan 1, 1970
   */
  function _internalGenerateSignature({
    uri,
    submissionId,
    formId,
    epoch,
  }: {
    uri: string
    submissionId: Object
    formId: string
    epoch: number
  }) {
    const baseString = `${
      url.parse(uri).href
    }.${submissionId}.${formId}.${epoch}`
    return sign(baseString, webhookSecretKey)
  }

  return _internalGenerateSignature
}

/**
 * Constructs the `X-FormSG-Signature` header
 * @param params The parameters needed to construct the header
 * @param params.epoch Epoch timestamp
 * @param params.submissionId Mongo ObjectId
 * @param params.formId Mongo ObjectId
 * @param params.signature A signature generated by the generateSignature() function
 * @returns The `X-FormSG-Signature` header
 */
function constructHeader({
  epoch,
  submissionId,
  formId,
  signature,
}: {
  epoch: number
  submissionId: string
  formId: string
  signature: string
}) {
  return `t=${epoch},s=${submissionId},f=${formId},v1=${signature}`
}

/**
 * Provider that accepts configuration
 * before returning the webhooks module
 */
export = function (params: PackageInitParams = {}) {
  const { mode, webhookSecretKey } = params
  const webhookPublicKey = getPublicKey(mode)

  return {
    /* Verification functions */
    authenticate: authenticate(webhookPublicKey),
    /* Signing functions */
    /* Return noop if a webhookSecretKey is not provided. */
    generateSignature: webhookSecretKey
      ? generateSignature(webhookSecretKey)
      : function () {},
    constructHeader: webhookSecretKey ? constructHeader : function () {},
  }
}
