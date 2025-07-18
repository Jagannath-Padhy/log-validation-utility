import { Response, Request } from 'express'
import _ from 'lodash'
import { validateActionSchema } from '../../shared/validateLogs'
import { logger } from '../../shared/logger'
import { DOMAIN, IHttpResponse } from '../../shared/types'
import { actionsArray } from '../../constants'
import helper from './helper'

import { verify, hash } from '../../shared/crypto'

const controller = {
  validate: async (req: Request, res: Response): Promise<Response | void> => {
    console.log("++++++++++++++++ Validate is called")
    try {
      const { domain, version, payload, flow, bap_id, bpp_id } = req.body

      let result: { response?: string; success?: boolean; message?: string } = {}
      const splitPath = req.originalUrl.split('/')
      const pathUrl = splitPath[splitPath.length - 1]
      const normalisedDomain = helper.getEnumForDomain(pathUrl)

      switch (normalisedDomain) {
        case DOMAIN.RETAIL:
          {
            const { response, success, message } = await helper.validateRetail(
              domain,
              payload,
              version,
              flow,
              bap_id,
              bpp_id,
            )
            result = { response, success, message }
          }

          break
        case DOMAIN.LOGISTICS:
          // to-do
          throw new Error('Domain not supported yet')
          break
        case DOMAIN.FINANCE:
          {
            const { response, success, message } = await helper.validateFinance(domain, payload, version, flow)
            result = { response, success, message }
          }

          break
        case DOMAIN.MOBILITY:
          {
            const { response, success, message } = await helper.validateMobility(domain, payload, version, flow)
            result = { response, success, message }
          }

          break
        case DOMAIN.IGM:
          // eslint-disable-next-line no-case-declarations
          const { response, success, message } = await helper.validateIGM(payload, version, flow)
          result = { response, success, message }
          break
        case DOMAIN.RSF:
          {
            const { response, success, message } = await helper.validateRSF(payload, version)
            result = { response, success, message }
          }

          break
        default:
          throw new Error('Internal server error')
      }

      const { response, success, message } = result

      const httpResponse: IHttpResponse = {
        message,
        report: response,
        bpp_id,
        bap_id,
        domain,
        payload,
        reportTimestamp: new Date().toISOString(),
      }

      const { signature, currentDate } = await helper.createSignature({ message: JSON.stringify(httpResponse) })

     if(!success && response)return res.status(200).send({ success, response: httpResponse, signature, signTimestamp: currentDate })
      if (!success)
        return res.status(400).send({ success, response: httpResponse, signature, signTimestamp: currentDate })

      return res.status(200).send({ success, response: httpResponse, signature, signTimestamp: currentDate })
    } catch (error: any) {
      logger.error(error)
      return res.status(500).send({ success: false, response: { message: error?.message || error } })
    }
  },

  validateToken: async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const { success, response, signature, signTimestamp } = req.body

      // Validate required fields exist
      if (
        signature === undefined ||
        signTimestamp === undefined ||
        response === undefined ||
        success === undefined ||
        response.payload === undefined // Check payload inside response
      ) {
        throw new Error('Payload must contain: signature, signTimestamp, success, response (with payload)')
      }

      const publicKey = process.env.SIGN_PUBLIC_KEY as string
      if (!publicKey) {
        throw new Error('Server configuration error: SIGN_PUBLIC_KEY not set')
      }

      // Create httpResponse from the response object
      const httpResponse: IHttpResponse = {
        message: response.message,
        report: response.report,
        bpp_id: response.bpp_id,
        bap_id: response.bap_id,
        domain: response.domain,
        payload: response.payload, // Get payload from response
        reportTimestamp: response.reportTimestamp,
      }

      const hashString = await hash({ message: JSON.stringify(httpResponse) })
      const signingString = `${hashString}|${signTimestamp}`

      const isVerified = await verify({
        signedMessage: signature,
        message: signingString,
        publicKey,
      })

      return res.status(200).send({
        success: true,
        response: {
          message: isVerified ? 'Signature verification successful' : 'Invalid signature',
          verified: isVerified,
        },
      })
    } catch (error: any) {
      logger.error('Signature verification failed:', error)
      return res.status(400).send({
        success: false,
        response: {
          message: error?.message || 'Signature verification failed',
        },
      })
    }
  },

  validateSingleAction: async (req: Request, res: Response): Promise<Response | void> => {
    try {
      let error
      if (!req.body) return res.status(400).send({ success: false, error: 'provide transaction logs to verify' })
      const { context, message } = req.body

      if (!context || !message) return res.status(400).send({ success: false, error: 'context, message are required' })

      if (!context.domain || !context.core_version || !context.action) {
        return res
          .status(400)
          .send({ success: false, error: 'context.domain, context.core_version, context.action is required' })
      }

      const { domain, core_version, action } = req.body.context
      if (!actionsArray.includes(action)) {
        return res.status(400).send({ success: false, error: 'context.action should be valid' })
      }

      const payload = req.body
      switch (core_version) {
        case '1.2.0':
        case '1.2.5':
          error = validateActionSchema(payload, domain, action)
          break
        default:
          logger.warn('Invalid core_version !! ')
          res.status(400).send({ success: false, error: 'Invalid core_version, Please Enter a valid core_version' })
          return
      }

      if (!_.isEmpty(error)) res.status(400).send({ success: false, error })
      else return res.status(200).send({ success: true, error })
    } catch (error) {
      logger.error(error)
      return res.status(500).send({ success: false, error: error })
    }
  },
  getValidationFormat: async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const upperDomain = req.params.dom
      const { domain, version } = req.query
      if (!domain || !version) return res.status(400).send({ success: false, error: 'domain, version are required' })

      const domainEnum = helper.getEnumForDomain(upperDomain)

      switch (domainEnum) {
        case DOMAIN.FINANCE:
          const format = helper.getFinanceValidationFormat(domain as string, version as string)
          return res.status(200).send({ success: true, response: format })
        default:
          return res.status(400).send({ success: false, error: 'Domain not supported yet' })
      }
    } catch (error) {
      logger.error(error)
      return res.status(500).send({ success: false, error: error })
    }
  },
  healthCheck: async(req: Request, res: Response): Promise<Response |void> =>{
    try {
      logger.info(req)
     return res.status(200).send({success: true, status:"OK"})
    }
    catch(error){
      logger.error(error)
      return res.status(500).send({success: false, status:"fail"})
    }
  }
}

export default controller
