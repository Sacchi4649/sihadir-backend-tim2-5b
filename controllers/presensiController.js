"use strict";
const presensiModel = require("../models/presensiSchema");
const mahasiswaModel = require("../models/mahasiswaSchema");
const dosenModel = require("../models/dosenSchema");
const userModel = require("../models/userSchema");
const jadwalModel = require("../models/jadwalSchema");
const getHari = require("../utils/getHari");
const kompensasiCounter = require("../utils/kompensasiCounter");
const statusCounter = require("../utils/statusCounter");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const dayjs = require("dayjs");
dayjs.extend(utc);
dayjs.extend(timezone);
const _ = require("lodash");

class presensiController {
  static async getPresensi(request, response, next) {
    try {
      const userUsername = request.userUsername;
      const { limit = 10, offset = 0, search = "" } = request.query;

      const findPresensi = await presensiModel
        .find({
          $or: [{ status: { $regex: new RegExp(search, "i") } }],
        })
        .where("mahasiswa.nim" || "dosen.nip")
        .equals(userUsername)
        .limit(limit)
        .skip(offset);
      const count = await presensiModel
        .find({
          $or: [{ status: { $regex: new RegExp(search, "i") } }],
        })
        .where("mahasiswa.nim" || "dosen.nip")
        .equals(userUsername)
        .count();
      const pagination = {
        page: offset ? offset / limit + 1 : 1,
        per_page: limit * 1,
        total_data: count,
      };
      response.status(200).json({ presensi: findPresensi, pagination });
    } catch (error) {
      next(error);
    }
  }

  static async isiPresensiMahasiswa(request, response, next) {
    try {
      const { idJadwal } = request.body;
      const userRole = request.userRole;
      const userUsername = request.userUsername;
      const findMahasiswa = await mahasiswaModel.findOne({ nim: userUsername });
      const findJadwal = await jadwalModel.findOne({ _id: idJadwal });
      const dateFormat = dayjs
        .tz(dayjs(), "Asia/Jakarta")
        .format("YYYY-MM-DD hh:mm");
      const day = getHari(dayjs.tz(dayjs(), "Asia/Jakarta").day());
      const hour = dayjs.tz(dayjs(), "Asia/Jakarta").format("hh:mm");
      console.log(dayjs.tz(dayjs(), "Asia/Jakarta").day()); //1995-12-17T03:24:00

      let telat = -1,
        slotJadwal;

      if (!(userRole != "admin"))
        throw {
          message: "Role admin tidak bisa presensi!",
          name: "ForbiddenError",
        };

      const {
        _id,
        hari,
        jam_mulai,
        jam_selesai,
        slot,
        ruang,
        semester,
        kelas,
        tahun,
        dosen_pengampu,
        matakuliah,
        surat,
      } = findJadwal;

      if (!(semester == findMahasiswa.semester && kelas == findMahasiswa.kelas))
        throw { message: "Tidak ada kelas", name: "BadRequestError" };

      if (!(hari == day && hour >= jam_mulai && hour <= jam_selesai))
        throw { message: "Tidak ada jadwal", name: "BadRequestError" };

      if (
        (hour >= "09:30" && hour <= "09:45") ||
        (hour >= "12:15" && hour <= "13:00") ||
        (hour >= "14:40" && hour < "15:30")
      )
        throw {
          message: "Tidak dapat melakukan presensi saat jam istirahat",
          name: "BadRequestError",
        };

      if (findMahasiswa.status_sp == "do")
        throw {
          message: "Mahasiswa sudah di drop out",
          name: "BadRequestError",
        };

      for (const key in findJadwal.slot) {
        telat++;
        if (
          hour >= findJadwal.slot[key].mulai &&
          hour <= findJadwal.slot[key].selesai
        ) {
          slotJadwal = key;
          break;
        }
      }
      let alpha = telat;
      const hitungStatus = findMahasiswa.total_alpha + telat;
      const hitungKompen = kompensasiCounter(alpha);
      const kompen = findMahasiswa.kompensasi + hitungKompen;
      const checkStatus = statusCounter(hitungStatus);

      await mahasiswaModel.findOneAndUpdate(
        { nim: userUsername },
        {
          total_alpha: hitungStatus,
          kompensasi: kompen,
          status_sp: checkStatus,
        },
        {
          new: true,
          upsert: true,
        }
      );

      const presensi = new presensiModel({
        status: "hadir",
        waktu_presensi: dateFormat,
        mahasiswa: {
          id: findMahasiswa._id,
          nama: findMahasiswa.nama,
          nim: findMahasiswa.nim,
          kompensasi_didapat: hitungKompen,
          alpha_didapat: telat,
          status_sp: checkStatus,
        },

        jadwal: {
          id: _id,
          hari,
          jam_mulai,
          jam_selesai,
          slotJadwal: slotJadwal,
          waktuSlot: findJadwal.slot[slotJadwal],
          ruang,
          semester,
          kelas,
          tahun,
          dosen_pengampu,
          matakuliah,
          surat,
        },
        surat: "",
      });

      await presensi.save();

      response.status(200).json({ presensi: presensi });
    } catch (error) {
      next(error);
    }
  }

  static async isiAlphaMahasiswa(request, response, next) {
    try {
      const { idJadwal, idMahasiswa } = request.body;
      const userRole = request.userRole;
      const findMahasiswa = await mahasiswaModel.findOne({ _id: idMahasiswa });
      const findJadwal = await jadwalModel.findOne({ _id: idJadwal });
      const date = new Date();
      const dateFormat = dayjs
        .tz(dayjs(), "Asia/Jakarta")
        .format("YYYY-MM-DD hh:mm");
      const day = getHari(dayjs.tz(dayjs(), "Asia/Jakarta").day());
      const hour = dayjs.tz(dayjs(), "Asia/Jakarta").format("hh:mm");
      // date.getHours() + ":" + date.getMinutes();
      let telat = -1,
        slotJadwal;

      const {
        _id,
        hari,
        jam_mulai,
        jam_selesai,
        slot,
        ruang,
        semester,
        kelas,
        tahun,
        dosen_pengampu,
        matakuliah,
        surat,
      } = findJadwal;

      if (!(userRole == "dosen"))
        throw {
          message: "Unauthorized role!",
          name: "ForbiddenError",
        };
      if (!(semester == findMahasiswa.semester && kelas == findMahasiswa.kelas))
        throw { message: "Tidak ada kelas", name: "BadRequestError" };

      if (!(hari == day && hour > jam_selesai))
        throw {
          message: "Mata kuliah masih berlangsung!",
          name: "BadRequestError",
        };

      if (findMahasiswa.status_sp == "do")
        throw {
          message: "Mahasiswa sudah di drop out",
          name: "BadRequestError",
        };

      for (const key in findJadwal.slot) {
        telat++;
        if (
          hour >= findJadwal.slot[key].mulai &&
          hour <= findJadwal.slot[key].selesai
        ) {
          slotJadwal = key;
          break;
        }
      }

      let alpha = telat;
      const hitungStatus = findMahasiswa.total_alpha + telat;
      const hitungKompen = kompensasiCounter(alpha);
      const kompen = findMahasiswa.kompensasi + hitungKompen;
      const checkStatus = statusCounter(hitungStatus);

      await mahasiswaModel.findOneAndUpdate(
        { _id: idMahasiswa },
        {
          total_alpha: hitungStatus,
          kompensasi: kompen,
          status_sp: checkStatus,
        },
        {
          new: true,
          upsert: true,
        }
      );

      const presensi = new presensiModel({
        status: "alpha",
        waktu_presensi: dateFormat,
        mahasiswa: {
          id: findMahasiswa._id,
          nama: findMahasiswa.nama,
          nim: findMahasiswa.nim,
          kompensasi_didapat: hitungKompen,
          alpha_didapat: telat,
          status_sp: checkStatus,
        },

        jadwal: {
          id: _id,
          hari,
          jam_mulai,
          jam_selesai,
          slotJadwal: slotJadwal,
          waktuSlot: findJadwal.slot[slotJadwal],
          ruang,
          semester,
          kelas,
          tahun,
          dosen_pengampu,
          matakuliah,
          surat,
        },
        surat: "",
      });

      await presensi.save();

      response.status(200).json({ presensi: presensi });
    } catch (error) {
      next(error);
    }
  }

  static async isiPresensiDosen(request, response, next) {
    try {
      const userUsername = request.userUsername;
      const userRole = request.userRole;
      const dateFormat = dayjs
        .tz(dayjs(), "Asia/Jakarta")
        .format("YYYY-MM-DD hh:mm");
      const day = getHari(dayjs.tz(dayjs(), "Asia/Jakarta").day());
      const hour = dayjs.tz(dayjs(), "Asia/Jakarta").format("hh:mm");
      // date.getHours() + ":" + date.getMinutes();

      if (userRole == "admin" || userRole == "mahasiswa")
        throw {
          message: "Tidak ada izin akses",
          name: "ForbiddenError",
        };

      const findPresensi = await presensiModel
        .find({
          waktu_presensi: {
            $regex:
              dayjs.tz(dayjs(), "Asia/Jakarta").format("YYYY-MM-DD") + ".*",
          },
        })
        .where("dosen.nip")
        .equals(userUsername);

      if (!_.isEmpty(findPresensi)) {
        throw {
          message: "Anda sudah presensi hari ini",
          name: "BadRequestError",
        };
      }

      if (!(hour >= "02:00" && hour <= "17:00"))
        throw { message: "Tidak ada jam kerja", name: "BadRequestError" };

      const findDosen = await dosenModel.findOne({ nip: userUsername });
      const presensi = new presensiModel({
        status: "hadir",
        waktu_presensi: dateFormat,
        dosen: {
          id: findDosen._id,
          nama: findDosen.nama,
          nip: findDosen.nip,
        },
      });

      await presensi.save();

      response.status(200).json({ presensi: presensi });
    } catch (error) {
      next(error);
    }
  }
  static async koreksiPresensi(request, response, next) {
    try {
      const { status, idPresensi, idJadwal, surat } = request.body;
      const findPresensi = await presensiModel.findOne({
        _id: idPresensi,
      });
      const findJadwal = await jadwalModel.findOne({ _id: idJadwal });
      const { hari } = findJadwal;
      const date = new Date();
      const day = getHari(date.getDay());

      if (findPresensi.status != "hadir" && hari == day) {
        if (findPresensi._id == idPresensi) {
          const updatePresensi = await presensiModel.findOneAndUpdate(
            { _id: idPresensi },
            {
              status,
              surat,
            },
            {
              new: true,
              upsert: true,
            }
          );
          response.status(200).json({ presensi: updatePresensi });
        }
      }
    } catch (error) {
      next(error);
    }
  }
}

module.exports = presensiController;
