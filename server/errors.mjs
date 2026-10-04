export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = () => new ApiError(404, 'INVITATION_NOT_FOUND', '暂时找不到这份邀请，请检查链接是否完整。');
