import 'whatwg-fetch';
import {publish} from "@uxland/uxl-event-aggregator/event-aggregator";
import {microTask} from '@polymer/polymer/lib/utils/async';
declare function serialize(key: string, value: string): string;
export interface Configuration{
    headers?: any;
    credentials?: string;
    mode: string;
}

export interface BapiRet{
    TYPE: string;
    MESSAGE: any;
    LOG_NO: any;
}
export interface InvalidRequestPayload{
    statusText?: string;
    status?: number;
}
export interface IFetchClient{
    fetch(input: any, requestInit?: any, queryParams?: any): Promise<any>;
    handleBapiRet(bapiRet: BapiRet): any;
}
export type ResponseHandler = <T>(response) => T;

const SAP_CLIENT_PARAM = 'sap-client';

const ABSOLUTE_URL_REGEX = /^([a-z][a-z0-9+\-.]*:)?\/\//i;

const BAPIRET_ERROR_CODE = "E";

export const INVALID_CREDENTIALS_EVENT = "UXL-CLIENT:INVALID_CREDENTIALS_EVENT";
export const RESET_CREDENTIALS_EVENT = "UXL-CLIENT:RESET_CREDENTIALS_EVENT";
export const INVALID_REQUEST_EVENT = "UXL-CLIENT:INVALID_REQUEST_EVENT";


const configuration: Configuration = {
    headers: {
        'Content-Type': 'application/json'
    },
    credentials: 'include',
    mode: 'cors'
};

let baseUrl: string;
let defaultQueryParams: {};

const getRequestUrl = function (baseUrl, url, queryParams = {}) {
    if (ABSOLUTE_URL_REGEX.test(url)) {
        return url;
    }

    let resultingUrl = (baseUrl || '') + url;
    let params = toQueryParams(Object.assign({}, defaultQueryParams, queryParams));
    return params ? resultingUrl + '?' + params : resultingUrl;
};

const mergeRequest = function (requestInit: RequestInit, config: Configuration) {
    requestInit = requestInit || {};
    config = config || configuration;
    let headers = Object.assign({}, config.headers, requestInit.headers || {});
    return Object.assign({}, config, requestInit, {headers: headers});
};

const getCode = (r: any) =>{
    let code = r ? r.result || r.RESULT : null;
    if(code){
        try{
            return parseInt(code);
        }catch (e){
            return null;
        }
    }
    return null;
};

const isUnauthorizedResponse = (r: any) =>{
    let code = getCode(r);
    return code && code == 401;
};
const isInvalidRequest = (r: any) =>{
    let code = getCode(r);
    return code && code >= 400;
};
const isResetCredentialsResponse = (r: any) => {
    let code = getCode(r);
    return code && code == 402;
};

const getError = (r: any): InvalidRequestPayload =>{
    return {status: getCode(r), statusText: r.text || r.TEXT};
};

const responseHandlers: ResponseHandler[] = [];

const defaultResponseHandler = <T>(result: T) =>{
    if(isUnauthorizedResponse(result)){
        microTask.run(() => publish(INVALID_CREDENTIALS_EVENT, result));
        throw getError(result);
    }
    if(isResetCredentialsResponse(result)){
        microTask.run(() => publish(RESET_CREDENTIALS_EVENT, result));
        throw getError(result);
    }
    if(isInvalidRequest(result)){
        microTask.run(() => publish(INVALID_REQUEST_EVENT, getError(result)));
        throw getError(result);
    }
    return result;
};

export const handleResponse = <T>(response: Response): Promise<T> =>{
    return response.json()
        .then( r => responseHandlers.reduce((previousValue, currentValue) => currentValue(previousValue), r));
};
export const handleErrors = async(response: Response) => {
    if (!response.ok) {
        let error;
        try{
            const result = await response.json();
            error = Object.assign(new Error(), result, {status: response.status, statusText: response.statusText});
        }catch (e) {
            error = Object.assign(new Error(), {status: response.status, statusText: response.statusText});
        }

        if(response.status === 401)
            microTask.run(() => publish(INVALID_CREDENTIALS_EVENT, error));
        if(response.status === 402)
            microTask.run(() => publish(RESET_CREDENTIALS_EVENT, error));
        else
            microTask.run(() => publish(INVALID_REQUEST_EVENT, error));
        throw error;
    }
    return response;
};

const serializeValue = function(value){
    return value === null || typeof value === 'undefined' ? '' : encodeURIComponent(value);
};

const toQueryParams = function (queryParams: object, prefix?: any) {
    let str = [], p;
    for(p in queryParams) {
        if (queryParams.hasOwnProperty(p)) {
            let k = prefix ? prefix + "[" + p + "]" : p, v = queryParams[p];
            str.push((v !== null && typeof v === "object") ?
                serialize(v, k) :
                encodeURIComponent(k) + "=" + serializeValue(v));
        }
    }
    return str.join("&");
};


export const configure = (config: Configuration) => {
    Object.assign(configuration, config);
};

export const withHeaders = (headers: any) =>{
    Object.assign(configuration.headers, headers);
};

export const removeHeader = (header: string) =>{
  if(configuration.headers[header])
      delete configuration.headers[header];
};

export const withBaseUrl = (url: string) =>{
    baseUrl = url;
};

export const withQueryParams = (queryParams: any) =>{
    defaultQueryParams = queryParams;
};

export const withSapClientParam = (sapClient: string) =>{
    let queryParams = {};
    queryParams[SAP_CLIENT_PARAM] = sapClient;
    withQueryParams(queryParams);
};

export const handleBapiret =(bapiRet: BapiRet | BapiRet[]): string =>{
    let arr = [].concat(bapiRet);
    let ret = arr[0];
    if(ret && ret.TYPE == BAPIRET_ERROR_CODE)
        throw new Error(ret.MESSAGE);
    return ret ? ret.MESSAGE : '';
};

class FetchClient implements IFetchClient{
    fetch<T>(input: any, requestInit?: any, queryParams?: any): Promise<T> {
        return fetch(getRequestUrl(baseUrl, input, queryParams), mergeRequest(requestInit, configuration))
            .then(r => handleErrors(r))
            .then(r => handleResponse<T>(r));
    }
    handleBapiRet = handleBapiret;
}



export class ServiceBase{
    private _fetchClient: FetchClient;
    get fetchClient(): IFetchClient{
        if(this._fetchClient == null)
            this._fetchClient = new FetchClient();
        return this._fetchClient;
    }
}
export const fetchClient = new FetchClient();
export const registerResponseHandler = (handler: ResponseHandler) =>{
    responseHandlers.push(handler);
};
registerResponseHandler(defaultResponseHandler);